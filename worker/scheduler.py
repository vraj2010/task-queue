import asyncio
import time
import logging
import os
from pathlib import Path

log = logging.getLogger("scheduler")

# Load promote script at import time
_SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "taskq"
    / "promote_delayed.lua"
)

with open(_SCRIPT_PATH, "r") as f:
    _PROMOTE_SCRIPT = f.read()

_promote_sha: str | None = None


async def _get_promote_sha(r) -> str:
    global _promote_sha

    if _promote_sha is None:
        _promote_sha = await r.script_load(_PROMOTE_SCRIPT)

    return _promote_sha


async def scheduler_loop(
    queue: str = "default",
    check_interval: float = 1.0,  # check every 1 second
):
    """
    Runs every `check_interval` seconds.

    Finds jobs in queue:delayed whose run_at has passed and
    atomically moves them to queue:{queue} (the active queue).
    """
    from api.database import get_redis  # avoid circular import at top level

    r = await get_redis()

    delayed_key = "queue:delayed"
    active_key = f"queue:{queue}"

    log.info(
        f"Scheduler started — checking {delayed_key} "
        f"every {check_interval}s"
    )

    while True:
        await asyncio.sleep(check_interval)

        try:
            now_ms = int(time.time() * 1000)

            sha = await _get_promote_sha(r)

            promoted = await r.evalsha(
                sha,
                2,  # number of KEYS
                delayed_key,  # KEYS[1]
                active_key,  # KEYS[2]
                str(now_ms),  # ARGV[1] — current time in ms
                "0",  # ARGV[2] — unused, kept for extensibility
            )

            if promoted and int(promoted) > 0:
                log.info(
                    f"[SCHED] promoted {promoted} delayed job(s) "
                    f"→ {active_key}"
                )

        except Exception as e:
            # Never crash the scheduler — just log and retry next tick
            log.error(f"[SCHED] error during promotion: {e}")