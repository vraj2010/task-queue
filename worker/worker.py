import asyncio
import json
from api.database import get_db, get_redis
from taskq.redis_queue import claim_job, ack_job, enqueue_job


async def send_email_handler(payload: dict):
    print(f"Sending email to: {payload.get('to')}")
    await asyncio.sleep(10)  # TEMP: slowed down for testing visibility key
    return {"sent": True, "to": payload.get("to")}


async def resize_image_handler(payload: dict):
    print(f"Resizing image: {payload.get('url')}")
    await asyncio.sleep(0.2)
    return {"resized": True}


HANDLERS = {
    "send_email": send_email_handler,
    "resize_image": resize_image_handler,
}


async def process_job(job_id: str, db, r):
    row = await db.fetchrow(
        "SELECT * FROM jobs WHERE job_id=$1", job_id
    )

    if not row:
        print(f"[WARN] {job_id} not found, releasing visibility key")
        await ack_job(r, job_id)  # clean up orphaned key
        return

    handler_fn = HANDLERS.get(row["handler"])

    if not handler_fn:
        await db.execute(
            "UPDATE jobs SET status='failed', error=$1 WHERE job_id=$2",
            f"Unknown handler: {row['handler']}",
            job_id
        )
        await ack_job(r, job_id)
        return

    # Mark running in Postgres
    await db.execute(
        "UPDATE jobs SET status='running', started_at=NOW() WHERE job_id=$1",
        job_id
    )

    try:
        # FIX 1: payload comes back as a JSON string from asyncpg.
        # Parse it safely whether it's a string or already a dict.
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)

        result = await handler_fn(payload)

        # SUCCESS — delete visibility key + mark complete
        await ack_job(r, job_id)

        # FIX 2: result is a Python dict — must be JSON-serialized
        # and cast to jsonb before going into the result column.
        await db.execute(
            """UPDATE jobs SET
            status='completed', completed_at=NOW(), result=$1::jsonb
            WHERE job_id=$2""",
            json.dumps(result),
            job_id
        )
        print(f"[OK] {job_id} ({row['handler']}) done")

    except Exception as e:
        # FAILURE — do NOT delete visibility key
        # Let it expire naturally, monitor will re-enqueue
        await db.execute(
            "UPDATE jobs SET status='pending', attempts=attempts+1, "
            "error=$1 WHERE job_id=$2",
            str(e),
            job_id
        )
        # Also manually re-enqueue for faster retry (don't wait for monitor)
        await ack_job(r, job_id)
        await enqueue_job(r, row["queue"], job_id, row["priority"])
        print(f"[FAIL] {job_id} failed — re-queued. Error: {e}")


async def worker_loop(queue: str = "default"):
    db = await get_db()
    r = await get_redis()
    print(f"Worker running — polling queue:{queue}")

    while True:
        # Phase 2: atomic claim via Lua script
        job_id = await claim_job(r, queue)

        if job_id is None:
            await asyncio.sleep(0.5)
            continue

        print(f"[PICK] claimed {job_id}")
        await process_job(job_id, db, r)


if __name__ == "__main__":
    asyncio.run(worker_loop())