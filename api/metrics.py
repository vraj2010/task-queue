import asyncio


async def get_status_snapshot(db) -> dict:
    row = await db.fetchrow("""
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'running')   AS running,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed
        FROM jobs
    """)
    return dict(row)


async def get_throughput(db) -> dict:
    row = await db.fetchrow("""
        SELECT
          COUNT(*) FILTER (
            WHERE completed_at >= NOW() - INTERVAL '1 minute'
          ) AS last_1_min,

          COUNT(*) FILTER (
            WHERE completed_at >= NOW() - INTERVAL '5 minutes'
          ) AS last_5_min,

          COUNT(*) FILTER (
            WHERE completed_at >= NOW() - INTERVAL '1 hour'
          ) AS last_1_hour,

          COUNT(*) FILTER (
            WHERE completed_at >= NOW() - INTERVAL '24 hours'
          ) AS last_24_hours

        FROM jobs
        WHERE status = 'completed'
    """)
    return dict(row)


async def get_failure_rate(db) -> dict:
    row = await db.fetchrow("""
        SELECT
          ROUND(
            100.0 *
            COUNT(*) FILTER (
              WHERE status = 'failed'
              AND created_at >= NOW() - INTERVAL '1 hour'
            )
            / NULLIF(
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '1 hour'
                AND status IN ('completed', 'failed')
              ), 0
            ), 2
          ) AS last_1_hour_pct,

          ROUND(
            100.0 *
            COUNT(*) FILTER (
              WHERE status = 'failed'
              AND created_at >= NOW() - INTERVAL '24 hours'
            )
            / NULLIF(
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                AND status IN ('completed', 'failed')
              ), 0
            ), 2
          ) AS last_24_hours_pct

        FROM jobs
    """)
    return {
        "last_1_hour_pct":   float(row["last_1_hour_pct"] or 0),
        "last_24_hours_pct": float(row["last_24_hours_pct"] or 0),
    }


async def get_latency(db) -> dict:
    row = await db.fetchrow("""
        SELECT
          ROUND(AVG(
            EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
          ))::INT AS avg_ms,

          ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
          ) * 1000)::INT AS p50_ms,

          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
          ) * 1000)::INT AS p95_ms,

          ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
          ) * 1000)::INT AS p99_ms

        FROM jobs
        WHERE status = 'completed'
          AND completed_at >= NOW() - INTERVAL '1 hour'
          AND started_at IS NOT NULL
    """)
    return {
        "avg_ms": row["avg_ms"] or 0,
        "p50_ms": row["p50_ms"] or 0,
        "p95_ms": row["p95_ms"] or 0,
        "p99_ms": row["p99_ms"] or 0,
    }


async def get_queue_depth(r) -> dict:
    default_depth = await r.zcard("queue:default")
    delayed_depth = await r.zcard("queue:delayed")
    return {
        "default": default_depth,
        "delayed": delayed_depth,
    }


async def get_throughput_over_time(db) -> list:
    """Returns per-minute job counts for the last hour — used for charts."""
    rows = await db.fetch("""
        SELECT
          DATE_TRUNC('minute', completed_at) AS minute,
          COUNT(*)                            AS jobs_completed
        FROM jobs
        WHERE
          status = 'completed'
          AND completed_at >= NOW() - INTERVAL '1 hour'
        GROUP BY DATE_TRUNC('minute', completed_at)
        ORDER BY minute ASC
    """)
    return [
        {
            "minute": row["minute"].isoformat(),
            "jobs_completed": row["jobs_completed"],
        }
        for row in rows
    ]


async def get_failure_by_handler(db) -> list:
    """Returns failure rate broken down by handler — useful for debugging."""
    rows = await db.fetch("""
        SELECT
          handler,
          COUNT(*)                                         AS total,
          COUNT(*) FILTER (WHERE status = 'failed')        AS failed,
          COUNT(*) FILTER (WHERE status = 'completed')     AS completed,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'failed')
            / NULLIF(COUNT(*), 0), 2
          ) AS failure_pct
        FROM jobs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY handler
        ORDER BY failure_pct DESC
    """)
    return [
        {
            "handler":     row["handler"],
            "total":       row["total"],
            "failed":      row["failed"],
            "completed":   row["completed"],
            "failure_pct": float(row["failure_pct"] or 0),
        }
        for row in rows
    ]


async def get_all_metrics() -> dict:
    from api.database import get_db, get_redis

    db = await get_db()
    r  = await get_redis()

    (
        snapshot,
        throughput,
        failure,
        latency,
        depth,
        throughput_chart,
        failure_by_handler,
    ) = await asyncio.gather(
        get_status_snapshot(db),
        get_throughput(db),
        get_failure_rate(db),
        get_latency(db),
        get_queue_depth(r),
        get_throughput_over_time(db),
        get_failure_by_handler(db),
    )

    return {
        "snapshot":            snapshot,
        "throughput":          throughput,
        "failure_rate":        failure,
        "latency":             latency,
        "queue_depth":         depth,
        "throughput_chart":    throughput_chart,
        "failure_by_handler":  failure_by_handler,
    }