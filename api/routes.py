from fastapi import APIRouter, HTTPException

from api.models import JobRequest, JobResponse
from api.database import get_db, get_redis
from api.metrics import get_all_metrics
from taskq.redis_queue import (
    enqueue_job,
    enqueue_delayed,
    queue_depth,
    peek_delayed,
)
import time
import json

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

    row = await db.fetchrow(
        """
        INSERT INTO jobs (handler, payload, priority, queue,
                      max_retries, run_at)
        VALUES ($1, $2::jsonb, $3, $4, 3, NOW() + $5 * interval '1 second')
        RETURNING id, created_at
        """,
        req.handler,
        json.dumps(req.payload),
        req.priority,
        req.queue,
        req.delay_seconds,
    )

    job_id = to_base62(row["id"])

    await db.execute(
        "UPDATE jobs SET job_id=$1 WHERE id=$2",
        job_id,
        row["id"],
    )

    if req.delay_seconds > 0:
        run_at_ms = int(time.time() * 1000) + (req.delay_seconds * 1000)
        await enqueue_delayed(r, job_id, run_at_ms)
    else:
        await enqueue_job(r, req.queue, job_id, req.priority, 0)

    return {
        "job_id":        job_id,
        "status":        "pending",
        "handler":       req.handler,
        "queue":         req.queue,
        "priority":      req.priority,
        "delay_seconds": req.delay_seconds,
        "created_at":    row["created_at"],
    }

@router.get("/jobs")
async def list_jobs(
    status: str = None,
    handler: str = None,
    page: int = 1,
    limit: int = 20,
):
    db = await get_db()
    offset = (page - 1) * limit

    conditions = []
    params = []
    idx = 1

    if status:
        conditions.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    if handler:
        conditions.append(f"handler ILIKE ${idx}")
        params.append(f"%{handler}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    count_row = await db.fetchrow(
        f"SELECT COUNT(*) as total FROM jobs {where}", *params
    )
    total = count_row["total"]

    rows = await db.fetch(
        f"""
        SELECT job_id, handler, status, priority, queue,
               attempts, max_retries, payload, result,
               error, run_at, started_at, completed_at, created_at
        FROM jobs
        {where}
        ORDER BY id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, limit, offset
    )

    return {
        "jobs":  [dict(r) for r in rows],
        "total": total,
        "page":  page,
        "limit": limit,
        "pages": max(1, -(-total // limit)),
    }

@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    db = await get_db()

    row = await db.fetchrow(
        "SELECT * FROM jobs WHERE job_id=$1",
        job_id,
    )

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    return dict(row)


@router.get("/queues/{queue}/depth")
async def get_depth(queue: str):
    r = await get_redis()
    return {"queue": queue, "depth": await queue_depth(r, queue)}


@router.get("/queues/delayed/peek")
async def peek_delayed_jobs():
    r = await get_redis()
    jobs  = await peek_delayed(r, limit=10)
    depth = await r.zcard("queue:delayed")
    return {"depth": depth, "next_jobs": jobs}


@router.get("/metrics")
async def metrics():
    return await get_all_metrics()