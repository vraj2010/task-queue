import asyncio

from worker.pool import WorkerPool
from worker.monitor import recovery_monitor
from worker.scheduler import scheduler_loop

CONCURRENCY = 2  # number of concurrent worker coroutines


async def main():
    pool = WorkerPool(
        concurrency=CONCURRENCY,
        queue="default",
    )

    # Run pool + monitor + scheduler all concurrently
    await asyncio.gather(
        pool.run(),
        recovery_monitor(check_interval=60),
        scheduler_loop(queue="default", check_interval=1.0),
    )


if __name__ == "__main__":
    asyncio.run(main())