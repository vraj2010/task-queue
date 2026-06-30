import asyncio
from worker.worker import worker_loop
from worker.monitor import recovery_monitor

async def main():
    # Run worker + monitor concurrently in the same process
    await asyncio.gather(
        worker_loop("default"),
        recovery_monitor(check_interval=60)
    )

if __name__ == "__main__":
    asyncio.run(main())