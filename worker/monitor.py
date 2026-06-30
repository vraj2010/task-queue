import asyncio

from api.database import get_db, get_redis
from taskq.redis_queue import enqueue_job


async def recovery_monitor(check_interval: int = 60):
    """
    Runs every `check_interval` seconds.

    Finds jobs stuck in 'running' status whose visibility timeout has
    expired (meaning the worker crashed) and re-enqueues them automatically.
    """

    db = await get_db()
    r = await get_redis()

    print(f"Recovery monitor started (checks every {check_interval}s)")

    while True:
        await asyncio.sleep(check_interval)

        # Find jobs marked 'running' in Postgres
        # whose processing key has expired in Redis
        running_jobs = await db.fetch(
            """
            SELECT job_id, queue, priority, attempts, max_retries
            FROM jobs
            WHERE status = 'running'
            """
        )

        recovered = 0

        for job in running_jobs:
            key = f"processing:{job['job_id']}"

            still_alive = await r.exists(key)

            if not still_alive:
                # Visibility timeout expired — worker crashed

                if job["attempts"] >= job["max_retries"]:
                    # Exceeded retries → move to failed
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status='failed',
                            error='Worker crashed — max retries exceeded'
                        WHERE job_id=$1
                        """,
                        job["job_id"],
                    )

                    print(f"[DLQ] {job['job_id']} moved to failed")

                else:
                    # Re-enqueue for retry
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status='pending',
                            attempts=attempts+1
                        WHERE job_id=$1
                        """,
                        job["job_id"],
                    )

                    await enqueue_job(
                        r,
                        job["queue"],
                        job["job_id"],
                        job["priority"],
                    )

                    recovered += 1

                    print(
                        f"[RECV] {job['job_id']} re-enqueued after crash"
                    )

        if recovered:
            print(f"[RECV] recovered {recovered} crashed job(s)")