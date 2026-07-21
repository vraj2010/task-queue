<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" />
  <img src="https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=black" />
</p>

# ⚙️ Task Queue — Distributed Background Job Processing System

### Production-Grade Background Job Engine with Priority Scheduling, Atomic Claiming, and Real-Time Observability

> **Disclaimer:** This is an educational portfolio project built to demonstrate distributed systems concepts through a real-world background job processing workflow.

---

## 📖 Project Overview

**Task Queue** is a distributed background job processing system built from scratch in Python — the same pattern powering background job processing at companies like Swiggy, Razorpay, and Flipkart.

When a web application needs to perform a time-consuming operation without blocking the user — sending emails, processing images, generating reports, or hitting external APIs — it enqueues a background job. This system guarantees that job runs **reliably**, **exactly once**, even if the worker crashes mid-execution.

The system is built across five phases: a core queue engine, reliability primitives (atomic claiming + visibility timeout), a concurrent worker pool with heartbeat tracking, a delayed job scheduler, and a real-time observability dashboard with a job simulator and task monitor.

---

## ✨ Core Features

- **Priority Queue:** Jobs are scored by priority and timestamp — urgent jobs always run before normal ones, with FIFO ordering within the same priority band.
- **Atomic Job Claiming:** Redis Lua scripts make ZPOPMIN + SET atomic — two workers can never claim the same job, eliminating race conditions entirely.
- **Visibility Timeout Pattern:** Claimed jobs get a TTL key in Redis. If a worker crashes mid-execution, the key expires and a recovery monitor re-enqueues the job automatically.
- **Delayed Job Scheduling:** Jobs can be scheduled for future execution. A scheduler loop promotes due jobs from `queue:delayed` to the active queue every 10 seconds via atomic Lua promotion.
- **Concurrent Worker Pool:** N workers run concurrently via `asyncio.gather()`, each independently claiming and processing jobs from the shared queue.
- **Heartbeat Tracking:** Each worker writes a `worker:{id}` key to Redis every 60 seconds. The recovery monitor detects dead workers via expired heartbeat keys.
- **Graceful Shutdown:** On `SIGTERM`, workers stop claiming new jobs but finish any in-flight work before exiting — zero job loss on deploys.
- **Exponential Backoff Retries:** Failed jobs are re-enqueued with increasing delay. After `max_retries` attempts, jobs move to failed status.
- **Live Metrics API:** A single `/metrics` endpoint runs five Postgres queries in parallel using `asyncio.gather()` — throughput, failure rate, p50/p95/p99 latency, and queue depth.
- **Real-Time Dashboard:** React dashboard with job simulator, live job feed, task monitor, throughput charts, and latency visualisation.

---

## 🏗️ System Architecture

### Full System Overview

```mermaid
flowchart TB
    classDef client fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#000;
    classDef api fill:#FFF3E0,stroke:#E65100,stroke-width:2px,color:#000;
    classDef queue fill:#FFEBEE,stroke:#C62828,stroke-width:2px,color:#000;
    classDef db fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#000;
    classDef worker fill:#F3E5F5,stroke:#6A1B9A,stroke-width:2px,color:#000;
    classDef dashboard fill:#ECEFF1,stroke:#455A64,stroke-width:2px,color:#000;

    Client((Client Apps)):::client
    Dashboard[React Dashboard\nSimulator · Monitor · Metrics]:::dashboard

    Client -->|POST /jobs| API
    Dashboard -->|GET /metrics\nGET /jobs| API

    subgraph APILayer["FastAPI Server"]
        API[Routes\nEnqueue · Status · Metrics · Monitor]:::api
    end

    API -->|Postgres-first write| DB
    API -->|ZADD to sorted set| Redis

    subgraph Storage["Storage Layer"]
        DB[(PostgreSQL\nDurable Job Log\nAudit Trail\nAnalytics)]:::db
        Redis[(Redis\nPriority Queue\nVisibility Keys\nHeartbeat Keys\nDelayed Queue)]:::queue
    end

    subgraph WorkerLayer["Worker Layer"]
        Pool[Worker Pool\nN concurrent workers\nasyncio.gather]:::worker
        Scheduler[Scheduler Loop\nPromotes delayed jobs\nevery 10s]:::worker
        Monitor[Recovery Monitor\nDetects crashed workers\nevery 60s]:::worker
    end

    Redis -->|ZPOPMIN via Lua| Pool
    Pool -->|UPDATE status| DB
    Pool -->|ACK — DEL key| Redis
    Scheduler -->|ZRANGEBYSCORE + ZADD Lua| Redis
    Monitor -->|Re-enqueue crashed jobs| Redis
```

### Job Lifecycle

```mermaid
flowchart TD
    classDef step fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#000;
    classDef store fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#000;
    classDef outcome fill:#ECEFF1,stroke:#455A64,stroke-width:2px,color:#000;
    classDef fail fill:#FFEBEE,stroke:#C62828,stroke-width:2px,color:#000;

    Submit[Client submits job\nPOST /jobs]:::step
    Insert[INSERT to PostgreSQL\nstatus = pending]:::store
    Enqueue[ZADD to Redis sorted set\nscore = priority × 10¹³ + timestamp]:::store
    Claim[Worker claims job\nLua — ZPOPMIN + SETEX]:::step
    Visibility[processing:job_id key\nTTL = 5 minutes]:::store
    Running[UPDATE status = running\nstarted_at = NOW]:::store
    Execute[Execute handler function]:::step
    Success[ACK — DEL visibility key\nstatus = completed]:::outcome
    Failure[Re-enqueue with backoff\nattempts++]:::fail
    DLQ[status = failed\nMax retries exceeded]:::fail
    Crash[Worker crash\nVisibility key expires]:::fail
    Recover[Recovery monitor\nRe-enqueues job]:::step

    Submit --> Insert --> Enqueue --> Claim
    Claim --> Visibility --> Running --> Execute
    Execute -->|Success| Success
    Execute -->|Exception| Failure
    Failure -->|attempts < max_retries| Enqueue
    Failure -->|attempts >= max_retries| DLQ
    Claim -.->|Worker crashes| Crash
    Crash -.->|TTL expires| Recover
    Recover -.-> Enqueue
```

---

## 🔄 Queue Phases

### Phase 1 — Core Queue Engine
Enqueue jobs via REST API, score-based priority ordering via Redis Sorted Set, PostgreSQL as durable source of truth with Postgres-first write order, Base62 job IDs generated from auto-increment primary key.

### Phase 2 — Reliability Primitives
Atomic job claiming via Redis Lua script, visibility timeout pattern for crash recovery, exponential backoff with jitter, dead letter queue for permanently failed jobs.

### Phase 3 — Concurrent Worker Pool
N workers via `asyncio.gather()`, per-worker heartbeat keys in Redis, graceful drain on `SIGTERM`, job chaining support.

### Phase 4 — Delayed Job Scheduler
Separate `queue:delayed` sorted set scored by Unix timestamp, atomic promotion via Lua script, scheduler loop runs every 10 seconds.

### Phase 5 — Observability Dashboard
Live metrics API with five parallel Postgres queries, React dashboard with job simulator, real-time feed, task monitor with filters and pagination, throughput charts, latency percentile bars.

---

## 💻 Tech Stack

### Backend

| Technology | Purpose |
|-----------|---------|
| Python 3.13 | Core language |
| FastAPI | REST API framework |
| asyncpg | Async PostgreSQL driver |
| redis-py (async) | Redis client |
| Pydantic v2 | Request/response validation |
| asyncio | Concurrent worker execution |

### Storage

| Technology | Purpose |
|-----------|---------|
| PostgreSQL 16 | Durable job log, audit trail, analytics |
| Redis 7 | Priority queue, visibility keys, heartbeats, delayed queue |

### Frontend

| Technology | Purpose |
|-----------|---------|
| React | Dashboard UI |
| Recharts | Throughput + latency charts |
| Vite | Build tool |

### Infrastructure

| Technology | Purpose |
|-----------|---------|
| Docker Compose | Local Postgres + Redis |
| Render | FastAPI hosting (free tier) |
| Railway | Worker process + Postgres |
| Redis Cloud | Managed Redis (30MB free, no request limits) |
| Vercel | React dashboard hosting |

---

## 🚀 Live Demo

| Service | URL |
|---------|-----|
| 📊 Dashboard | https://task-queue-one.vercel.app |
| 🔌 API Swagger | https://task-queue-api-qcqz.onrender.com/docs |
| 📡 Metrics | https://task-queue-api-qcqz.onrender.com/api/v1/metrics |

---

## 🛠️ Getting Started

### Prerequisites

- Python 3.13+
- Node.js 18+
- Docker Desktop

### 1. Clone the Repository

```bash
git clone https://github.com/vraj2010/task-queue.git
cd task-queue
```

### 2. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Start Local Infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL 16 on port `5433`
- Redis 7 on port `6379`

### 4. Configure Environment

```bash
cp .env.example .env
```

`.env` contents:
```
DATABASE_URL=postgresql://taskuser:taskpass@localhost:5433/taskqueue
REDIS_URL=redis://localhost:6379
```

### 5. Run the Schema

```bash
docker exec -it task-queue-postgres-1 psql -U taskuser -d taskqueue
```

Paste the contents of `schema.sql`, then `\q` to exit.

### 6. Start All Services

```bash
# Terminal 1 — API server
uvicorn api.main:app --reload --port 8000

# Terminal 2 — Worker pool + scheduler + monitor
python -m worker.run

# Terminal 3 — React dashboard
cd dashboard
npm install
npm run dev
```

### 7. Local Endpoints

| Endpoint | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| Swagger UI | http://localhost:8000/docs |
| Metrics API | http://localhost:8000/api/v1/metrics |

---

## 📡 API Reference

### Submit a Job

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "handler": "send_email",
    "payload": {"to": "user@example.com"},
    "priority": 5,
    "delay_seconds": 0
  }'
```

**Response:**
```json
{
  "job_id": "1",
  "status": "pending",
  "handler": "send_email",
  "queue": "default",
  "priority": 5,
  "delay_seconds": 0,
  "created_at": "2026-07-06T10:00:00Z"
}
```

### Check Job Status

```bash
curl http://localhost:8000/api/v1/jobs/1
```

### List Jobs with Filters

```bash
# All jobs
curl http://localhost:8000/api/v1/jobs

# Filter by status
curl "http://localhost:8000/api/v1/jobs?status=completed&page=1&limit=20"

# Search by handler
curl "http://localhost:8000/api/v1/jobs?handler=send_email"
```

### Submit a Delayed Job

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "handler": "send_email",
    "payload": {"to": "user@example.com"},
    "priority": 5,
    "delay_seconds": 30
  }'
```

### Get Live Metrics

```bash
curl http://localhost:8000/api/v1/metrics
```

**Response:**
```json
{
  "snapshot":    { "pending": 0, "running": 0, "completed": 42, "failed": 1 },
  "throughput":  { "last_1_min": 5, "last_5_min": 18, "last_1_hour": 42 },
  "failure_rate":{ "last_1_hour_pct": 2.3, "last_24_hours_pct": 1.8 },
  "latency":     { "avg_ms": 134, "p50_ms": 98, "p95_ms": 412, "p99_ms": 1023 },
  "queue_depth": { "default": 0, "delayed": 2 }
}
```

---

## 📁 Project Structure

```
task-queue/
├── api/
│   ├── main.py              # FastAPI app + CORS middleware
│   ├── routes.py            # All API endpoints
│   ├── models.py            # Pydantic request/response models
│   ├── database.py          # asyncpg pool + Redis client
│   └── metrics.py           # Parallel SQL queries for dashboard
├── worker/
│   ├── pool.py              # WorkerPool + Worker class + heartbeat
│   ├── scheduler.py         # Delayed job promotion loop
│   ├── monitor.py           # Crash recovery monitor
│   └── run.py               # Entry point — asyncio.gather all three
├── taskq/
│   ├── redis_queue.py       # ZADD / ZPOPMIN / enqueue helpers
│   ├── claim_job.lua        # Atomic claim Lua script
│   └── promote_delayed.lua  # Atomic delayed promotion Lua script
├── dashboard/               # React + Recharts frontend
│   └── src/
│       └── App.jsx          # Dashboard + Simulator + Monitor
├── schema.sql               # PostgreSQL schema (jobs + workers tables)
├── docker-compose.yml       # Local Postgres + Redis
├── render.yaml              # Render deployment config
├── requirements.txt         # Python dependencies
└── .env.example             # Environment variable template
```

---

## 🧠 System Design Decisions

### Why Redis Sorted Sets for the queue?

`ZADD` and `ZPOPMIN` are O(log N). Rank queries on 10 million jobs cost the same as on 1000. The score formula `(MAX_PRIORITY - priority) × 10¹³ + run_at_ms` encodes both priority ordering and FIFO tiebreaking in a single integer — no secondary sorting needed.

### Why Lua scripts for job claiming?

Redis is single-threaded. Lua scripts execute atomically — no other command can run between `ZPOPMIN` and `SET`. Two workers cannot race to claim the same job. Without this, running multiple workers causes duplicate job execution. This is the same mechanism AWS SQS uses internally with its visibility timeout.

### Why Postgres-first write order?

The API inserts to Postgres before pushing to Redis. If Redis fails after the Postgres write, the job is safe — a reconciliation job can re-enqueue it. The reverse creates orphaned Redis entries with no source of truth.

### Why visibility timeout over simple delete-on-claim?

If a worker deletes a job from the queue and then crashes before completing it, the job is permanently lost. Visibility timeout keeps a `processing:{job_id}` key with TTL. If the worker does not ACK within 5 minutes, the recovery monitor detects the missing key and re-enqueues the job. This guarantees at-least-once delivery.

### Why asyncio over threading for workers?

Job handlers are I/O bound — they wait on network calls, database queries, and external APIs. asyncio's cooperative multitasking is more efficient than thread-per-worker because it avoids GIL contention and context-switching overhead. N concurrent workers run in a single thread via `asyncio.gather()`.

### CAP trade-off in the scheduler

The scheduler uses eventual consistency — delayed jobs may promote a few seconds late if the scheduler loop is busy. This is an AP (availability over consistency) choice. For delayed job scheduling, a 10-second window is acceptable. Blocking on strict quorum for exact timing would hurt throughput without meaningful benefit.

---

## 📌 Project Scope

This repository is built to demonstrate distributed systems and backend engineering concepts in a portfolio environment.

It should not be interpreted as:

- a production deployment at FAANG scale;
- proof of sub-millisecond job processing latency under heavy load;
- a horizontally scalable multi-region queue;
- a benchmarked replacement for Celery, BullMQ, or AWS SQS; or
- evidence of enterprise-grade availability or fault tolerance.

Performance numbers should only be claimed after running reproducible benchmark scripts with documented hardware, workloads, and measured results.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add or update relevant tests and documentation
4. Commit your changes
5. Open a pull request

---

## 📄 License

MIT © Vraj Patel