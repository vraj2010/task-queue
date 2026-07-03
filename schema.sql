CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  job_id       TEXT        NOT NULL UNIQUE DEFAULT '',
  queue        TEXT        NOT NULL DEFAULT 'default',
  handler      TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed')),
  priority     INT         NOT NULL DEFAULT 0,
  attempts     INT         NOT NULL DEFAULT 0,
  max_retries  INT         NOT NULL DEFAULT 3,
  run_at       TIMESTAMPTZ          DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result       JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_queue  ON jobs (queue, status);
CREATE INDEX idx_jobs_run_at ON jobs (run_at) WHERE status = 'pending';

CREATE TABLE workers (
  worker_id      TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','draining','dead')),
  jobs_processed INT NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);