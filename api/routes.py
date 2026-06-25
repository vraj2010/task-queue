from fastapi import APIRouter, HTTPException

from api.models import JobRequest, JobResponse
from api.database import get_db, get_redis
from taskq.redis_queue import enqueue_job, queue_depth

router = APIRouter()

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def to_base62(n: int) -> str:
    if n == 0:
        return "0"

    result = []

    while n:
        result.append(BASE62[n % 62])
        n //= 62

    return "".join(reversed(result))


@router.post("/jobs", status_code=201)
async def create_job(req: JobRequest):
    db = await get_db()
    r = await get_redis()

    # 1. Insert row (job_id filled after we know the id)
    row = await db.fetchrow(
        """
        INSERT INTO jobs
            (handler, payload, priority, queue, max_retries, run_at)
        VALUES
            ($1, $2, $3, $4, 3, NOW() + $5 * interval '1 second')
        RETURNING id, created_at
        """,
        req.handler,
        req.payload,
        req.priority,
        req.queue,
        req.delay_seconds,
    )

    job_id = to_base62(row["id"])

    # 2. Backfill the job_id
    await db.execute(
        "UPDATE jobs SET job_id=$1 WHERE id=$2",
        job_id,
        row["id"],
    )

    # 3. Push to Redis
    await enqueue_job(
        r,
        req.queue,
        job_id,
        req.priority,
        req.delay_seconds,
    )

    return {
        "job_id": job_id,
        "status": "pending",
        "handler": req.handler,
        "queue": req.queue,
        "priority": req.priority,
        "created_at": row["created_at"],
    }


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    db = await get_db()

    row = await db.fetchrow(
        "SELECT * FROM jobs WHERE job_id=$1",
        job_id,
    )

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return dict(row)


@router.get("/queues/{queue}/depth")
async def get_depth(queue: str):
    r = await get_redis()

    return {
        "queue": queue,
        "depth": await queue_depth(r, queue),
    }