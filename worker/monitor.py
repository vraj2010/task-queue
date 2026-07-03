import asyncio
import logging

from api.database import get_db, get_redis
from taskq.redis_queue import enqueue_job

log = logging.getLogger("monitor")


async def recovery_monitor(check_interval: int = 60):
    """
    Runs every check_interval seconds.

    1. Finds jobs stuck in 'running' whose visibility timeout expired
       (worker crashed mid-job) — re-enqueues them.
    2. Logs which worker:{id} heartbeat keys have expired
       (dead workers) — useful for alerting / dashboard,
       even though job recovery doesn't depend on worker identity directly.
    """
    db = await get_db()
    r = await get_redis()

    log.info(f"Recovery monitor started (every {check_interval}s)")

    while True:
        await asyncio.sleep(check_interval)

        running_jobs = await db.fetch(
            "SELECT job_id, queue, priority, attempts, max_retries "
            "FROM jobs WHERE status = 'running'"
        )

        recovered = 0

        for job in running_jobs:
            key = f"processing:{job['job_id']}"
            still_alive = await r.exists(key)

            if not still_alive:
                if job["attempts"] >= job["max_retries"]:
                    await db.execute(
                        "UPDATE jobs SET status='failed', "
                        "error='Worker crashed — max retries exceeded' "
                        "WHERE job_id=$1",
                        job["job_id"],
                    )

                    log.warning(f"[DLQ] {job['job_id']} moved to failed")

                else:
                    await db.execute(
                        "UPDATE jobs SET status='pending', "
                        "attempts=attempts+1 WHERE job_id=$1",
                        job["job_id"],
                    )

                    await enqueue_job(
                        r,
                        job["queue"],
                        job["job_id"],
                        job["priority"],
                    )

                    recovered += 1
                    log.info(f"[RECV] {job['job_id']} re-enqueued after crash")

        if recovered:
            log.info(f"[RECV] recovered {recovered} crashed job(s)")

        # Optional: report active worker count for visibility
        active_worker_keys = await r.keys("worker:*")

        log.info(
            f"[POOL] {len(active_worker_keys)} active worker(s) "
            f"reporting heartbeat"
        )