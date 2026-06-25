import time
from redis.asyncio import Redis

MAX_PRIORITY = 10


def compute_score(priority: int, delay_seconds: int = 0) -> float:
    inverted = MAX_PRIORITY - priority
    run_at_ms = int(time.time() * 1000) + delay_seconds * 1000

    return inverted * 10**13 + run_at_ms


async def enqueue_job(
    r: Redis,
    queue: str,
    job_id: str,
    priority: int = 0,
    delay_seconds: int = 0
):
    score = compute_score(priority, delay_seconds)

    await r.zadd(
        f"queue:{queue}",
        {job_id: score}
    )

    return score


async def dequeue_job(r: Redis, queue: str) -> str | None:
    items = await r.zpopmin(f"queue:{queue}", 1)

    if not items:
        return None

    return items[0][0]  # job_id string


async def queue_depth(r: Redis, queue: str) -> int:
    return await r.zcard(f"queue:{queue}")