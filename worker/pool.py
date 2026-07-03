import asyncio
import json
import signal
import uuid
import logging
from datetime import datetime, timezone

from api.database import get_db, get_redis
from taskq.redis_queue import claim_job, ack_job, enqueue_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
)
log = logging.getLogger("worker")

HEARTBEAT_INTERVAL = 30  # seconds between heartbeat writes
HEARTBEAT_TTL = 90  # Redis key expires if no heartbeat in 90s
POLL_IDLE_SLEEP = 0.5  # sleep when queue is empty


# --- Handler registry (same as before) ---
async def send_email_handler(payload: dict):
    log.info(f" Sending email to: {payload.get('to')}")
    await asyncio.sleep(0.1)
    return {"sent": True, "to": payload.get("to")}


async def resize_image_handler(payload: dict):
    log.info(f" Resizing image: {payload.get('url')}")
    await asyncio.sleep(0.2)
    return {"resized": True}


HANDLERS = {
    "send_email": send_email_handler,
    "resize_image": resize_image_handler,
}


class Worker:
    """
    A single worker coroutine.
    Multiple Worker instances run concurrently inside the WorkerPool.
    """

    def __init__(self, worker_id: str, queue: str, db, r):
        self.worker_id = worker_id
        self.queue = queue
        self.db = db
        self.r = r
        self.shutdown_requested = False
        self.current_job_id: str | None = None
        self.jobs_processed = 0

    async def run(self):
        log.info(f"[{self.worker_id}] started, polling queue:{self.queue}")

        # Launch heartbeat as a background task tied to this worker
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        try:
            while not self.shutdown_requested:
                job_id = await claim_job(self.r, self.queue)

                if job_id is None:
                    await asyncio.sleep(POLL_IDLE_SLEEP)
                    continue

                self.current_job_id = job_id
                await self._process_job(job_id)
                self.current_job_id = None
                self.jobs_processed += 1

        finally:
            heartbeat_task.cancel()
            await self._deregister()

            log.info(
                f"[{self.worker_id}] stopped. "
                f"Processed {self.jobs_processed} jobs total."
            )

    async def _process_job(self, job_id: str):
        row = await self.db.fetchrow(
            "SELECT * FROM jobs WHERE job_id=$1",
            job_id,
        )

        if not row:
            log.warning(f"[{self.worker_id}] {job_id} not found, releasing key")
            await ack_job(self.r, job_id)
            return

        handler_fn = HANDLERS.get(row["handler"])

        if not handler_fn:
            await self.db.execute(
                "UPDATE jobs SET status='failed', error=$1 WHERE job_id=$2",
                f"Unknown handler: {row['handler']}",
                job_id,
            )
            await ack_job(self.r, job_id)
            return

        await self.db.execute(
            "UPDATE jobs SET status='running', started_at=NOW() WHERE job_id=$1",
            job_id,
        )

        try:
            payload = row["payload"]

            if isinstance(payload, str):
                payload = json.loads(payload)

            result = await handler_fn(payload)

            await ack_job(self.r, job_id)

            await self.db.execute(
                """
                UPDATE jobs
                SET status='completed',
                    completed_at=NOW(),
                    result=$1::jsonb
                WHERE job_id=$2
                """,
                json.dumps(result),
                job_id,
            )

            log.info(f"[{self.worker_id}] [OK] {job_id} ({row['handler']})")

        except Exception as e:
            await self.db.execute(
                "UPDATE jobs SET status='pending', attempts=attempts+1, "
                "error=$1 WHERE job_id=$2",
                str(e),
                job_id,
            )

            await ack_job(self.r, job_id)
            await enqueue_job(
                self.r,
                row["queue"],
                job_id,
                row["priority"],
            )

            log.warning(f"[{self.worker_id}] [FAIL] {job_id}: {e}")

    async def _heartbeat_loop(self):
        """Writes worker:{id} key to Redis every HEARTBEAT_INTERVAL seconds."""
        try:
            while True:
                await self._beat()
                await asyncio.sleep(HEARTBEAT_INTERVAL)

        except asyncio.CancelledError:
            pass  # expected on shutdown

    async def _beat(self):
        now = datetime.now(timezone.utc).isoformat()

        await self.r.set(
            f"worker:{self.worker_id}",
            json.dumps(
                {
                    "status": (
                        "draining"
                        if self.shutdown_requested
                        else "active"
                    ),
                    "current_job": self.current_job_id,
                    "jobs_processed": self.jobs_processed,
                    "last_heartbeat": now,
                }
            ),
            ex=HEARTBEAT_TTL,
        )

    async def _deregister(self):
        """Clean removal on graceful shutdown (not just TTL expiry)."""
        await self.r.delete(f"worker:{self.worker_id}")

    def request_shutdown(self):
        log.info(f"[{self.worker_id}] shutdown requested — draining...")
        self.shutdown_requested = True


class WorkerPool:
    """
    Runs N Worker instances concurrently.
    Handles SIGTERM/SIGINT for graceful pool-wide shutdown.
    """

    def __init__(self, concurrency: int = 4, queue: str = "default"):
        self.concurrency = concurrency
        self.queue = queue
        self.workers: list[Worker] = []

    async def run(self):
        db = await get_db()
        r = await get_redis()

        self.workers = [
            Worker(
                worker_id=f"worker-{uuid.uuid4().hex[:8]}",
                queue=self.queue,
                db=db,
                r=r,
            )
            for _ in range(self.concurrency)
        ]

        loop = asyncio.get_running_loop()

        # Register signal handlers for graceful shutdown
        # (Windows note: SIGTERM works in WSL/Linux/Docker;
        # on native Windows PowerShell, Ctrl+C maps to SIGINT — both handled)
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(
                    sig,
                    self._handle_shutdown_signal,
                )
            except NotImplementedError:
                # add_signal_handler unsupported on this platform
                # (some Windows setups)
                signal.signal(
                    sig,
                    lambda *_: self._handle_shutdown_signal(),
                )

        log.info(
            f"WorkerPool starting — {self.concurrency} "
            f"workers on queue:{self.queue}"
        )

        await asyncio.gather(*(w.run() for w in self.workers))

        log.info("WorkerPool fully stopped.")

    def _handle_shutdown_signal(self):
        log.info("Shutdown signal received — draining all workers...")

        for w in self.workers:
            w.request_shutdown()