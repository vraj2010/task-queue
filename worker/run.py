import asyncio

from worker.pool import WorkerPool
from worker.monitor import recovery_monitor

CONCURRENCY = 4  # number of concurrent worker coroutines


async def main():
    pool = WorkerPool(
        concurrency=CONCURRENCY,
        queue="default",
    )

    await asyncio.gather(
        pool.run(),
        recovery_monitor(check_interval=60),
    )


if __name__ == "__main__":
    asyncio.run(main())