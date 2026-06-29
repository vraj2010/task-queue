import asyncio
import json

from api.database import get_db, get_redis
from taskq.redis_queue import dequeue_job


# --- Handler registry ---

# Add your actual task functions here
async def send_email_handler(payload: dict):
    print(f"Sending email to: {payload.get('to')}")
    await asyncio.sleep(0.1)  # simulate work
    return {
        "sent": True,
        "to": payload.get("to")
    }


async def resize_image_handler(payload: dict):
    print(f"Resizing image: {payload.get('url')}")
    await asyncio.sleep(0.2)  # simulate work
    return {
        "resized": True
    }


HANDLERS = {
    "send_email": send_email_handler,
    "resize_image": resize_image_handler,
}


# --- Core worker ---

async def process_job(job_id: str, db, r):
    row = await db.fetchrow(
        "SELECT * FROM jobs WHERE job_id=$1",
        job_id
    )

    if not row:
        print(f"[WARN] job {job_id} not found in DB, skipping")
        return

    handler_fn = HANDLERS.get(row["handler"])

    if not handler_fn:
        await db.execute(
            "UPDATE jobs SET status='failed', error=$1 WHERE job_id=$2",
            f"Unknown handler: {row['handler']}",
            job_id
        )
        return

    # Mark job as running
    await db.execute(
        "UPDATE jobs SET status='running', started_at=NOW() WHERE job_id=$1",
        job_id
    )

    try:
        result = await handler_fn(dict(row["payload"]))

        await db.execute(
            """
            UPDATE jobs
            SET status='completed',
                completed_at=NOW(),
                result=$1
            WHERE job_id=$2
            """,
            json.dumps(result),
            job_id
        )

        print(f"[OK] {job_id} ({row['handler']}) completed")

    except Exception as e:
        await db.execute(
            """
            UPDATE jobs
            SET status='pending',
                attempts=attempts+1,
                error=$1
            WHERE job_id=$2
            """,
            str(e),
            job_id
        )

        # Re-enqueue at same priority
        from taskq.redis_queue import enqueue_job

        await enqueue_job(
            r,
            row["queue"],
            job_id,
            row["priority"]
        )

        print(f"[FAIL] {job_id} failed, re-queued. Error: {e}")


async def worker_loop(queue: str = "default"):
    db = await get_db()
    r = await get_redis()

    print(f"Worker running — polling queue: {queue}")

    while True:
        job_id = await dequeue_job(r, queue)

        if job_id is None:
            await asyncio.sleep(0.5)
            continue

        print(f"[PICK] claimed {job_id}")

        await process_job(job_id, db, r)


if __name__ == "__main__":
    asyncio.run(worker_loop())