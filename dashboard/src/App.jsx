import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

// ── Config ─────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8000/api/v1";
const REFRESH_MS = 5000;

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg:       "#0F1117",
  surface:  "#181C27",
  border:   "#252A3A",
  text:     "#E8EAF0",
  muted:    "#6B7280",
  blue:     "#4F8EF7",
  green:    "#34D399",
  amber:    "#FBBF24",
  red:      "#F87171",
  purple:   "#A78BFA",
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? "—" : Number(n).toLocaleString(); }
function fmtMs(ms) {
  if (ms == null || ms === 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, color = C.text, sub }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 32, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: C.muted }}>{sub}</span>}
    </div>
  );
}

// ── Section heading ────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: C.muted,
        textTransform: "uppercase", letterSpacing: "0.1em",
        marginBottom: 12, paddingBottom: 8,
        borderBottom: `1px solid ${C.border}`
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Chart card ─────────────────────────────────────────────────────────────
function ChartCard({ title, height = 180, children }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "16px 20px",
    }}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ height }}>
        {children}
      </div>
    </div>
  );
}

// ── Status dot ─────────────────────────────────────────────────────────────
function Dot({ color }) {
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8,
      borderRadius: "50%",
      background: color,
      marginRight: 6,
    }} />
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: 12,
    }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>
          {fmt(p.value)}{unit}
        </div>
      ))}
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pulse, setPulse]     = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
      setPulse(p => !p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: C.muted, fontFamily: "system-ui, sans-serif", fontSize: 14,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 32, height: 32, border: `2px solid ${C.border}`,
          borderTopColor: C.blue, borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto 12px",
        }} />
        Connecting to API…
      </div>
    </div>
  );

  // ── Error ────────────────────────────────────────────────────────────────
  if (error && !data) return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 32, maxWidth: 420, textAlign: "center",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: C.text, fontWeight: 600, marginBottom: 8 }}>
          Cannot reach API
        </div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
          Make sure the API server is running at<br />
          <code style={{ color: C.blue }}>{API_BASE}</code>
        </div>
        <div style={{
          background: C.bg, borderRadius: 8, padding: "8px 12px",
          fontSize: 12, color: C.red, fontFamily: "monospace",
        }}>
          {error}
        </div>
        <button onClick={fetchMetrics} style={{
          marginTop: 16, padding: "8px 20px", borderRadius: 8,
          background: C.blue, color: "#fff", border: "none",
          cursor: "pointer", fontSize: 13, fontWeight: 600,
        }}>
          Retry
        </button>
      </div>
    </div>
  );

  const { snapshot, throughput, failure_rate, latency, queue_depth,
          throughput_chart, failure_by_handler } = data || {};

  // chart data
  const chartData = (throughput_chart || []).map(r => ({
    time: fmtTime(r.minute),
    jobs: r.jobs_completed,
  }));

  const handlerData = (failure_by_handler || []).map(r => ({
    name: r.handler,
    total: r.total,
    failed: r.failed,
    pct: r.failure_pct,
  }));

  const statusData = [
    { name: "Pending",   value: snapshot?.pending   || 0, color: C.amber  },
    { name: "Running",   value: snapshot?.running   || 0, color: C.blue   },
    { name: "Completed", value: snapshot?.completed || 0, color: C.green  },
    { name: "Failed",    value: snapshot?.failed    || 0, color: C.red    },
  ];

  const failurePct1h  = failure_rate?.last_1_hour_pct  || 0;
  const failureColor  = failurePct1h > 10 ? C.red : failurePct1h > 2 ? C.amber : C.green;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      fontFamily: "'Inter', system-ui, sans-serif",
      color: C.text,
      padding: "0 0 40px",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "16px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky", top: 0,
        background: C.bg,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: error ? C.red : C.green,
            boxShadow: error ? `0 0 6px ${C.red}` : `0 0 6px ${C.green}`,
          }} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>
            Task Queue
          </span>
          <span style={{
            fontSize: 11, color: C.muted,
            background: C.surface, border: `1px solid ${C.border}`,
            padding: "2px 8px", borderRadius: 99,
          }}>
            Dashboard
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {error && (
            <span style={{ fontSize: 11, color: C.red }}>
              ⚠ API error — showing stale data
            </span>
          )}
          <span style={{ fontSize: 11, color: C.muted }}>
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : "Connecting…"}
          </span>
          <button onClick={fetchMetrics} style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.muted, cursor: "pointer",
          }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 28px 0" }}>

        {/* Queue depth banner */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: "12px 20px",
          display: "flex", alignItems: "center", gap: 24,
          marginBottom: 28,
        }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            QUEUE DEPTH
          </span>
          <div style={{ display: "flex", gap: 20 }}>
            <span style={{ fontSize: 13, color: C.text }}>
              <span style={{ color: C.blue, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {fmt(queue_depth?.default)}
              </span>
              <span style={{ color: C.muted, marginLeft: 6 }}>active</span>
            </span>
            <span style={{ fontSize: 13, color: C.text }}>
              <span style={{ color: C.purple, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {fmt(queue_depth?.delayed)}
              </span>
              <span style={{ color: C.muted, marginLeft: 6 }}>delayed</span>
            </span>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
            Auto-refreshes every {REFRESH_MS / 1000}s
          </div>
        </div>

        {/* Status snapshot */}
        <Section title="Status snapshot">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {statusData.map(s => (
              <StatCard
                key={s.name}
                label={s.name}
                value={fmt(s.value)}
                color={s.color}
              />
            ))}
          </div>
        </Section>

        {/* Throughput */}
        <Section title="Throughput">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <StatCard label="Last 1 min"  value={fmt(throughput?.last_1_min)}    color={C.blue}  sub="jobs completed" />
            <StatCard label="Last 5 min"  value={fmt(throughput?.last_5_min)}    color={C.blue}  sub="jobs completed" />
            <StatCard label="Last 1 hour" value={fmt(throughput?.last_1_hour)}   color={C.blue}  sub="jobs completed" />
            <StatCard label="Last 24 hrs" value={fmt(throughput?.last_24_hours)} color={C.blue}  sub="jobs completed" />
          </div>

          <ChartCard title="Jobs completed — last hour (per minute)">
            {chartData.length === 0 ? (
              <div style={{
                height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: C.muted, fontSize: 13,
              }}>
                No completed jobs in the last hour yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: C.muted, fontSize: 11 }}
                    axisLine={{ stroke: C.border }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: C.muted, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip unit=" jobs" />} />
                  <Line
                    type="monotone"
                    dataKey="jobs"
                    stroke={C.blue}
                    strokeWidth={2}
                    dot={{ fill: C.blue, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Section>

        {/* Failure rate + latency side by side */}
        <Section title="Failure rate &amp; latency">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

            {/* Failure rate */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Failure rate
              </div>
              <div style={{ display: "flex", gap: 28, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: failureColor, lineHeight: 1.1 }}>
                    {failurePct1h.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>last 1 hour</div>
                </div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
                    {(failure_rate?.last_24_hours_pct || 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>last 24 hours</div>
                </div>
              </div>

              {handlerData.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>By handler (24h)</div>
                  {handlerData.map(h => (
                    <div key={h.name} style={{
                      display: "flex", alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderTop: `1px solid ${C.border}`,
                      fontSize: 12,
                    }}>
                      <span style={{ color: C.text, fontFamily: "monospace" }}>{h.name}</span>
                      <div style={{ display: "flex", gap: 16 }}>
                        <span style={{ color: C.muted }}>{h.total} total</span>
                        <span style={{ color: h.failed > 0 ? C.red : C.green }}>
                          {h.failed} failed
                        </span>
                        <span style={{
                          color: h.pct > 5 ? C.red : h.pct > 0 ? C.amber : C.green,
                          fontWeight: 600,
                        }}>
                          {h.pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Latency */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Processing latency — last 1 hour
              </div>

              {[
                { label: "Average",     value: latency?.avg_ms, color: C.text  },
                { label: "p50 median",  value: latency?.p50_ms, color: C.green },
                { label: "p95",         value: latency?.p95_ms, color: C.amber },
                { label: "p99",         value: latency?.p99_ms, color: C.red   },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                    <span style={{ fontSize: 12, color, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {fmtMs(value)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, ((value || 0) / Math.max(latency?.p99_ms || 1, 1)) * 100)}%`,
                      background: color,
                      borderRadius: 2,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Handler bar chart */}
        {handlerData.length > 0 && (
          <Section title="Jobs by handler (24h)">
            <ChartCard title="Total vs failed per handler" height={160}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={handlerData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="name"
                    tick={{ fill: C.muted, fontSize: 11, fontFamily: "monospace" }}
                    axisLine={false} tickLine={false} width={100}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total"  fill={C.blue}  radius={[0,4,4,0]} barSize={10} />
                  <Bar dataKey="failed" fill={C.red}   radius={[0,4,4,0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </Section>
        )}

      </div>
    </div>
  );
}