import time
import os
from redis.asyncio import Redis

MAX_PRIORITY = 10
VISIBILITY_TIMEOUT = 300 # seconds — 5 minutes

# Load Lua script at import time
_SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "claim_job.lua")
with open(_SCRIPT_PATH, "r") as f:
    _CLAIM_SCRIPT = f.read()

# Cache the registered script SHA (faster than sending full script each time)
_claim_sha: str | None = None

async def _get_claim_sha(r: Redis) -> str:
    global _claim_sha
    if _claim_sha is None:
        _claim_sha = await r.script_load(_CLAIM_SCRIPT)
    return _claim_sha

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
    await r.zadd(f"queue:{queue}", {job_id: score})
    return score

async def claim_job(r: Redis, queue: str) -> str | None:
    """Atomically pop + set visibility timeout via Lua."""
    sha = await _get_claim_sha(r)
    result = await r.evalsha(
        sha,
        2, # number of KEYS
        f"queue:{queue}", # KEYS[1]
        "processing", # KEYS[2]
        str(VISIBILITY_TIMEOUT) # ARGV[1]
    )
    return result # job_id string or None

async def ack_job(r: Redis, job_id: str):
    """Delete visibility key on successful completion."""
    await r.delete(f"processing:{job_id}")

async def queue_depth(r: Redis, queue: str) -> int:
    return await r.zcard(f"queue:{queue}")