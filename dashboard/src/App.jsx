import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Config ────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api/v1";
const REFRESH_MS    = 5000;
const JOB_POLL_MS   = 2000;
const MONITOR_MS    = 5000;

// ── Palette ───────────────────────────────────────────────────────────────
const C = {
  bg:      "#0F1117",
  surface: "#181C27",
  surface2:"#1E2336",
  border:  "#252A3A",
  text:    "#E8EAF0",
  muted:   "#6B7280",
  blue:    "#4F8EF7",
  green:   "#34D399",
  amber:   "#FBBF24",
  red:     "#F87171",
  purple:  "#A78BFA",
  cyan:    "#22D3EE",
};

const STATUS_COLOR = {
  pending:   C.amber,
  running:   C.blue,
  completed: C.green,
  failed:    C.red,
};

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(n)      { return n == null ? "—" : Number(n).toLocaleString(); }
function fmtMs(ms)   { if (!ms) return "—"; return ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`; }
function fmtTime(iso){ if (!iso) return ""; const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function timeAgo(iso){
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)    return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
  return `${Math.floor(diff/3600000)}h ago`;
}
function fmtDateTime(iso){
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

// ── Reusable UI ───────────────────────────────────────────────────────────
function StatCard({ label, value, color = C.text, sub }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px" }}>
      <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:30, fontWeight:700, color, fontVariantNumeric:"tabular-nums", lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{
        fontSize:11, fontWeight:600, color:C.muted, textTransform:"uppercase",
        letterSpacing:"0.1em", marginBottom:12, paddingBottom:8,
        borderBottom:`1px solid ${C.border}`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <span>{title}</span>{action}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ title, height=180, children }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 20px" }}>
      <div style={{ fontSize:12, color:C.muted, fontWeight:600, marginBottom:12 }}>{title}</div>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:C.muted, marginBottom:4 }}>{label}</div>
      {payload.map((p,i) => <div key={i} style={{ color:p.color||C.text }}>{fmt(p.value)}</div>)}
    </div>
  );
}

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || C.muted;
  return (
    <span style={{
      padding:"2px 9px", borderRadius:999, fontSize:11, fontWeight:500,
      background: color + "22", color,
    }}>
      {status}
    </span>
  );
}

function Btn({ onClick, children, color=C.blue, disabled, small, outline }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? "4px 10px" : "8px 16px",
      borderRadius:7, fontSize: small ? 11 : 13, fontWeight:600,
      background: outline ? "transparent" : disabled ? C.border : color,
      color: outline ? color : disabled ? C.muted : "#fff",
      border: `1px solid ${outline ? color : disabled ? C.border : color}`,
      cursor: disabled ? "not-allowed" : "pointer",
      transition:"all 0.15s", whiteSpace:"nowrap",
    }}>
      {children}
    </button>
  );
}

function ToggleBtn({ value, active, onClick, color=C.blue }) {
  return (
    <button onClick={onClick} style={{
      padding:"5px 12px", borderRadius:6, fontSize:12, fontWeight:500,
      border:`1px solid ${active ? color : C.border}`,
      background: active ? color+"22" : "transparent",
      color: active ? color : C.muted,
      cursor:"pointer", transition:"all 0.15s",
    }}>
      {value}
    </button>
  );
}

// ── Job Simulator ─────────────────────────────────────────────────────────
function JobSimulator({ onJobsSubmitted }) {
  const [handler,     setHandler]     = useState("send_email");
  const [priority,    setPriority]    = useState(5);
  const [delay,       setDelay]       = useState(0);
  const [count,       setCount]       = useState(1);
  const [submitting,  setSubmitting]  = useState(false);
  const [toast,       setToast]       = useState(null);

  const HANDLERS = [
    { value:"send_email",    label:"Send Email" },
    { value:"resize_image",  label:"Resize Image" },
  ];

  async function submit() {
    setSubmitting(true);
    setToast(null);
    const results = [];
    for (let i = 0; i < count; i++) {
      const payload = handler === "send_email"
        ? { to:`user${i+1}@demo.com`, subject:"Demo job" }
        : { url:`https://example.com/image${i+1}.jpg`, width:800 };
      try {
        const res = await fetch(`${API_BASE}/jobs`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ handler, payload, priority, delay_seconds:delay, queue:"default" }),
        });
        const d = await res.json();
        results.push(d);
      } catch (e) {
        results.push({ error:e.message });
      }
    }
    setSubmitting(false);
    const ok    = results.filter(r => r.job_id);
    const fail  = results.filter(r => r.error);
    if (ok.length)   setToast({ type:"ok",   text:`${ok.length} job${ok.length>1?"s":""} submitted — IDs: ${ok.map(r=>r.job_id).join(", ")}` });
    if (fail.length) setToast({ type:"err",  text:`Error: ${fail[0].error}` });
    onJobsSubmitted(ok);
  }

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px" }}>
      <div style={{ fontSize:12, color:C.muted, fontWeight:600, marginBottom:14, textTransform:"uppercase", letterSpacing:"0.08em" }}>
        Job Simulator
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        {/* Handler */}
        <div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>Handler</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {HANDLERS.map(h => (
              <ToggleBtn key={h.value} value={h.label}
                active={handler===h.value} onClick={()=>setHandler(h.value)} color={C.blue} />
            ))}
          </div>
        </div>

        {/* Batch size */}
        <div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>Batch size</div>
          <div style={{ display:"flex", gap:6 }}>
            {[1,5,10].map(n => (
              <ToggleBtn key={n} value={`${n} job${n>1?"s":""}`}
                active={count===n} onClick={()=>setCount(n)} color={C.purple} />
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>
            Priority — <span style={{ color:C.text, fontWeight:700 }}>{priority}</span>
          </div>
          <input type="range" min="0" max="10" value={priority}
            onChange={e=>setPriority(Number(e.target.value))}
            style={{ width:"100%", accentColor:C.blue }} />
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.muted, marginTop:2 }}>
            <span>Low (0)</span><span>High (10)</span>
          </div>
        </div>

        {/* Delay */}
        <div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>Schedule</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[0,10,30,60].map(d => (
              <ToggleBtn key={d} value={d===0?"Now":`+${d}s`}
                active={delay===d} onClick={()=>setDelay(d)} color={C.amber} />
            ))}
          </div>
        </div>
      </div>

      <Btn onClick={submit} disabled={submitting} color={C.blue}>
        {submitting ? "Submitting…" : `Submit ${count} ${count===1?"job":"jobs"}${delay>0?` (delayed ${delay}s)`:""}`}
      </Btn>

      {toast && (
        <div style={{
          marginTop:10, padding:"8px 12px", borderRadius:8,
          background:C.bg, border:`1px solid ${C.border}`,
          fontSize:12, color: toast.type==="ok" ? C.green : C.red,
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ── Live Job Feed ─────────────────────────────────────────────────────────
function LiveJobFeed({ jobs }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [jobs.length]);

  if (!jobs.length) return (
    <div style={{
      background:C.surface, border:`1px solid ${C.border}`, borderRadius:12,
      padding:"32px 20px", textAlign:"center", color:C.muted, fontSize:13,
    }}>
      Submit jobs from the simulator to see them appear here in real time.
    </div>
  );

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden" }}>
      <div style={{ maxHeight:300, overflowY:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {["Job ID","Handler","Status","Priority","Submitted"].map(h => (
                <th key={h} style={{
                  padding:"8px 12px", textAlign:"left",
                  fontSize:10, fontWeight:600, color:C.muted,
                  textTransform:"uppercase", letterSpacing:"0.06em",
                  background:C.bg, position:"sticky", top:0,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...jobs].reverse().map((job, i) => (
              <tr key={job.job_id} style={{
                borderBottom:`1px solid ${C.border}`,
                background: i===0 ? C.blue+"08" : "transparent",
                transition:"background 0.5s",
              }}>
                <td style={{ padding:"8px 12px", fontFamily:"monospace", color:C.cyan }}>{job.job_id}</td>
                <td style={{ padding:"8px 12px", color:C.text }}>{job.handler}</td>
                <td style={{ padding:"8px 12px" }}><StatusBadge status={job.status} /></td>
                <td style={{ padding:"8px 12px" }}>
                  <span style={{ padding:"2px 7px", borderRadius:999, fontSize:11, background:C.border, color:C.text }}>
                    P{job.priority}
                  </span>
                </td>
                <td style={{ padding:"8px 12px", color:C.muted }}>{timeAgo(job.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Task Monitor ──────────────────────────────────────────────────────────
function TaskMonitor() {
  const [jobs,        setJobs]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [pages,       setPages]       = useState(1);
  const [page,        setPage]        = useState(1);
  const [statusFilter,setStatusFilter]= useState("");
  const [search,      setSearch]      = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading,     setLoading]     = useState(false);
  const [expandedId,  setExpandedId]  = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchJobs = useCallback(async (pg=page, st=statusFilter, sch=search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:pg, limit:20 });
      if (st)  params.set("status",  st);
      if (sch) params.set("handler", sch);
      const res  = await fetch(`${API_BASE}/jobs?${params}`);
      const data = await res.json();
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (_) {}
    setLoading(false);
  }, [page, statusFilter, search]);

  useEffect(() => { fetchJobs(page, statusFilter, search); }, [page, statusFilter, search]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchJobs(page, statusFilter, search), MONITOR_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchJobs, page, statusFilter, search]);

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  const STATUS_FILTERS = ["", "pending", "running", "completed", "failed"];
  const STATUS_LABELS  = { "":"All", pending:"Pending", running:"Running", completed:"Completed", failed:"Failed" };
  const STATUS_COUNTS  = {};

  return (
    <div>
      {/* Controls */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
        {/* Status tabs */}
        <div style={{ display:"flex", gap:6 }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={()=>{ setStatusFilter(s); setPage(1); }} style={{
              padding:"5px 13px", borderRadius:6, fontSize:12, fontWeight:500,
              border:`1px solid ${statusFilter===s ? (STATUS_COLOR[s]||C.blue) : C.border}`,
              background: statusFilter===s ? (STATUS_COLOR[s]||C.blue)+"22" : "transparent",
              color: statusFilter===s ? (STATUS_COLOR[s]||C.blue) : C.muted,
              cursor:"pointer", transition:"all 0.15s",
            }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ display:"flex", gap:6, marginLeft:"auto" }}>
          <input
            value={searchInput}
            onChange={e=>setSearchInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && applySearch()}
            placeholder="Search by handler…"
            style={{
              padding:"5px 12px", borderRadius:6, fontSize:12,
              background:C.surface, border:`1px solid ${C.border}`,
              color:C.text, outline:"none", width:180,
            }}
          />
          <Btn onClick={applySearch} small color={C.blue}>Search</Btn>
          {search && <Btn onClick={()=>{ setSearch(""); setSearchInput(""); setPage(1); }} small outline color={C.muted}>Clear</Btn>}
        </div>

        {/* Auto refresh toggle */}
        <Btn onClick={()=>setAutoRefresh(r=>!r)} small outline color={autoRefresh ? C.green : C.muted}>
          {autoRefresh ? "Pause" : "Resume"} auto-refresh
        </Btn>

        <Btn onClick={()=>fetchJobs(page,statusFilter,search)} small outline color={C.blue}>Refresh</Btn>
      </div>

      {/* Stats row */}
      <div style={{
        display:"flex", gap:8, marginBottom:12, fontSize:12, color:C.muted,
        padding:"8px 12px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}`,
      }}>
        <span>Total: <strong style={{ color:C.text }}>{fmt(total)}</strong></span>
        {statusFilter && <span>Filtered: <strong style={{ color:STATUS_COLOR[statusFilter] }}>{statusFilter}</strong></span>}
        {search && <span>Handler: <strong style={{ color:C.text }}>{search}</strong></span>}
        <span style={{ marginLeft:"auto" }}>
          Page {page} of {pages} · {autoRefresh ? <span style={{ color:C.green }}>Live</span> : <span style={{ color:C.muted }}>Paused</span>}
        </span>
      </div>

      {/* Table */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden", marginBottom:12 }}>
        {loading && !jobs.length ? (
          <div style={{ padding:"32px", textAlign:"center", color:C.muted, fontSize:13 }}>Loading…</div>
        ) : !jobs.length ? (
          <div style={{ padding:"32px", textAlign:"center", color:C.muted, fontSize:13 }}>
            No jobs found{statusFilter ? ` with status "${statusFilter}"` : ""}{search ? ` matching "${search}"` : ""}
          </div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {["","Job ID","Handler","Status","Priority","Attempts","Created","Started","Completed"].map(h => (
                  <th key={h} style={{
                    padding:"9px 12px", textAlign:"left",
                    fontSize:10, fontWeight:600, color:C.muted,
                    textTransform:"uppercase", letterSpacing:"0.06em",
                    background:C.bg, position:"sticky", top:0,
                    whiteSpace:"nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <>
                  <tr
                    key={job.job_id}
                    onClick={()=>setExpandedId(expandedId===job.job_id ? null : job.job_id)}
                    style={{
                      borderBottom:`1px solid ${C.border}`,
                      cursor:"pointer",
                      background: expandedId===job.job_id ? C.blue+"08" : "transparent",
                    }}
                  >
                    <td style={{ padding:"8px 6px 8px 12px", color:C.muted, fontSize:10 }}>
                      {expandedId===job.job_id ? "▾" : "▸"}
                    </td>
                    <td style={{ padding:"8px 12px", fontFamily:"monospace", color:C.cyan }}>{job.job_id}</td>
                    <td style={{ padding:"8px 12px", color:C.text }}>{job.handler}</td>
                    <td style={{ padding:"8px 12px" }}><StatusBadge status={job.status} /></td>
                    <td style={{ padding:"8px 12px" }}>
                      <span style={{ padding:"2px 7px", borderRadius:999, fontSize:11, background:C.border, color:C.text }}>
                        P{job.priority}
                      </span>
                    </td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>
                      {job.attempts}/{job.max_retries}
                    </td>
                    <td style={{ padding:"8px 12px", color:C.muted, whiteSpace:"nowrap" }}>{timeAgo(job.created_at)}</td>
                    <td style={{ padding:"8px 12px", color:C.muted, whiteSpace:"nowrap" }}>
                      {job.started_at ? timeAgo(job.started_at) : "—"}
                    </td>
                    <td style={{ padding:"8px 12px", color:C.muted, whiteSpace:"nowrap" }}>
                      {job.completed_at ? timeAgo(job.completed_at) : "—"}
                    </td>
                  </tr>

                  {/* Expanded row */}
                  {expandedId===job.job_id && (
                    <tr key={job.job_id+"_exp"} style={{ background:C.surface2, borderBottom:`1px solid ${C.border}` }}>
                      <td colSpan={9} style={{ padding:"14px 18px" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>

                          <div>
                            <div style={{ fontSize:10, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Payload</div>
                            <pre style={{
                              fontFamily:"monospace", fontSize:11, color:C.text,
                              background:C.bg, padding:"8px 10px", borderRadius:6,
                              border:`1px solid ${C.border}`, overflow:"auto", maxHeight:120,
                              whiteSpace:"pre-wrap", wordBreak:"break-all",
                            }}>
                              {JSON.stringify(job.payload, null, 2)}
                            </pre>
                          </div>

                          <div>
                            <div style={{ fontSize:10, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Result</div>
                            <pre style={{
                              fontFamily:"monospace", fontSize:11,
                              color: job.result ? C.green : C.muted,
                              background:C.bg, padding:"8px 10px", borderRadius:6,
                              border:`1px solid ${C.border}`, overflow:"auto", maxHeight:120,
                              whiteSpace:"pre-wrap", wordBreak:"break-all",
                            }}>
                              {job.result ? JSON.stringify(job.result, null, 2) : "null"}
                            </pre>
                          </div>

                          <div>
                            <div style={{ fontSize:10, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
                              {job.error ? "Error" : "Timestamps"}
                            </div>
                            {job.error ? (
                              <pre style={{
                                fontFamily:"monospace", fontSize:11, color:C.red,
                                background:C.bg, padding:"8px 10px", borderRadius:6,
                                border:`1px solid ${C.border}`, overflow:"auto", maxHeight:120,
                                whiteSpace:"pre-wrap", wordBreak:"break-all",
                              }}>
                                {job.error}
                              </pre>
                            ) : (
                              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                                {[
                                  ["Created",   job.created_at],
                                  ["Run at",    job.run_at],
                                  ["Started",   job.started_at],
                                  ["Completed", job.completed_at],
                                ].map(([label, val]) => (
                                  <div key={label} style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
                                    <span style={{ color:C.muted }}>{label}</span>
                                    <span style={{ color:C.text, fontFamily:"monospace", fontSize:10 }}>
                                      {val ? fmtDateTime(val) : "—"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display:"flex", gap:6, justifyContent:"center", alignItems:"center" }}>
          <Btn onClick={()=>setPage(1)}       disabled={page===1}     small outline color={C.blue}>«</Btn>
          <Btn onClick={()=>setPage(p=>p-1)}  disabled={page===1}     small outline color={C.blue}>‹ Prev</Btn>
          {Array.from({length:Math.min(5,pages)}, (_,i) => {
            const p = Math.max(1, Math.min(page-2, pages-4)) + i;
            return (
              <Btn key={p} onClick={()=>setPage(p)} small
                color={C.blue} outline={page!==p}>
                {p}
              </Btn>
            );
          })}
          <Btn onClick={()=>setPage(p=>p+1)}  disabled={page===pages} small outline color={C.blue}>Next ›</Btn>
          <Btn onClick={()=>setPage(pages)}   disabled={page===pages} small outline color={C.blue}>»</Btn>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [data,         setData]         = useState(null);
  const [error,        setError]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [liveJobs,     setLiveJobs]     = useState([]);
  const [trackedIds,   setTrackedIds]   = useState([]);
  const [activeTab,    setActiveTab]    = useState("dashboard");

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  // Poll live job statuses
  const pollJobs = useCallback(async (ids) => {
    if (!ids.length) return;
    const updated = await Promise.all(
      ids.map(id => fetch(`${API_BASE}/jobs/${id}`).then(r => r.ok ? r.json() : null).catch(()=>null))
    );
    setLiveJobs(prev => {
      const map = new Map(prev.map(j=>[j.job_id,j]));
      updated.filter(Boolean).forEach(j => map.set(j.job_id, j));
      return Array.from(map.values());
    });
  }, []);

  useEffect(() => {
    if (!trackedIds.length) return;
    const id = setInterval(() => pollJobs(trackedIds), JOB_POLL_MS);
    return () => clearInterval(id);
  }, [trackedIds, pollJobs]);

  function handleJobsSubmitted(jobs) {
    const newJobs = jobs.map(j => ({
      job_id: j.job_id, handler: j.handler,
      status: j.status || "pending",
      priority: j.priority, created_at: j.created_at || new Date().toISOString(),
    }));
    setLiveJobs(prev => {
      const map = new Map(prev.map(j=>[j.job_id,j]));
      newJobs.forEach(j => map.set(j.job_id, j));
      return Array.from(map.values());
    });
    setTrackedIds(prev => [...new Set([...prev, ...jobs.map(j=>j.job_id)])]);
    setTimeout(fetchMetrics, 1000);
    setTimeout(fetchMetrics, 4000);
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:28, height:28, border:`2px solid ${C.border}`, borderTopColor:C.blue, borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 12px" }} />
        Connecting to API…
      </div>
    </div>
  );

  // ── Error ────────────────────────────────────────────────────────────────
  if (error && !data) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"system-ui,sans-serif" }}>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:32, maxWidth:380, textAlign:"center" }}>
        <div style={{ color:C.text, fontWeight:600, marginBottom:8 }}>Cannot reach API</div>
        <div style={{ color:C.muted, fontSize:13, marginBottom:14 }}>
          Make sure your API server is running at<br/>
          <code style={{ color:C.blue, fontSize:11 }}>{API_BASE}</code>
        </div>
        <div style={{ background:C.bg, borderRadius:8, padding:"8px 12px", fontSize:12, color:C.red, fontFamily:"monospace", marginBottom:16 }}>{error}</div>
        <button onClick={fetchMetrics} style={{ padding:"8px 20px", borderRadius:8, background:C.blue, color:"#fff", border:"none", cursor:"pointer", fontSize:13, fontWeight:600 }}>
          Retry
        </button>
      </div>
    </div>
  );

  const { snapshot, throughput, failure_rate, latency, queue_depth, throughput_chart, failure_by_handler } = data || {};
  const chartData   = (throughput_chart||[]).map(r=>({ time:fmtTime(r.minute), jobs:r.jobs_completed }));
  const handlerData = (failure_by_handler||[]).map(r=>({ name:r.handler, total:r.total, failed:r.failed, pct:r.failure_pct }));
  const failurePct  = failure_rate?.last_1_hour_pct || 0;
  const failureColor= failurePct>10 ? C.red : failurePct>2 ? C.amber : C.green;

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"'Inter',system-ui,sans-serif", color:C.text, paddingBottom:40 }}>
      <style>{`
        @keyframes spin { to { transform:rotate(360deg); } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:${C.bg}; }
        ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        borderBottom:`1px solid ${C.border}`, padding:"13px 28px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, background:C.bg, zIndex:10,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{
            width:8, height:8, borderRadius:"50%",
            background: error ? C.red : C.green,
            boxShadow: error ? `0 0 6px ${C.red}` : `0 0 8px ${C.green}`,
          }} />
          <span style={{ fontWeight:700, fontSize:15, letterSpacing:"-0.02em" }}>Task Queue</span>
          <span style={{ fontSize:11, color:C.muted, background:C.surface, border:`1px solid ${C.border}`, padding:"2px 8px", borderRadius:99 }}>
            Live Dashboard
          </span>
        </div>

        {/* Nav tabs */}
        <div style={{ display:"flex", gap:4 }}>
          {[["dashboard","Dashboard"],["monitor","Monitor"]].map(([tab,label]) => (
            <button key={tab} onClick={()=>setActiveTab(tab)} style={{
              padding:"6px 16px", borderRadius:7, fontSize:12, fontWeight:600,
              background: activeTab===tab ? C.blue : "transparent",
              color:      activeTab===tab ? "#fff" : C.muted,
              border:`1px solid ${activeTab===tab ? C.blue : C.border}`,
              cursor:"pointer", transition:"all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          {error && <span style={{ fontSize:11, color:C.red }}>stale data</span>}
          <span style={{ fontSize:11, color:C.muted }}>
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting…"}
          </span>
          <button onClick={fetchMetrics} style={{ padding:"4px 12px", borderRadius:6, fontSize:12, background:"transparent", border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer" }}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ maxWidth:1120, margin:"0 auto", padding:"24px 28px 0" }}>

        {/* ── Queue depth banner ── */}
        <div style={{
          background:C.surface, border:`1px solid ${C.border}`, borderRadius:12,
          padding:"10px 18px", display:"flex", alignItems:"center", gap:24, marginBottom:24,
        }}>
          <span style={{ fontSize:11, color:C.muted, fontWeight:600 }}>QUEUE DEPTH</span>
          <span style={{ fontSize:13 }}>
            <span style={{ color:C.blue, fontWeight:700 }}>{fmt(queue_depth?.default)}</span>
            <span style={{ color:C.muted, marginLeft:5 }}>active</span>
          </span>
          <span style={{ fontSize:13 }}>
            <span style={{ color:C.purple, fontWeight:700 }}>{fmt(queue_depth?.delayed)}</span>
            <span style={{ color:C.muted, marginLeft:5 }}>delayed</span>
          </span>
          <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>Auto-refreshes every {REFRESH_MS/1000}s</span>
        </div>

        {/* ═══════════════ DASHBOARD TAB ═══════════════ */}
        {activeTab==="dashboard" && (
          <>
            {/* Simulator + Feed */}
            <Section title="Simulate & observe">
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:4 }}>
                <JobSimulator onJobsSubmitted={handleJobsSubmitted} />
                <div>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                    Real-time Job Feed
                    {liveJobs.length>0 && <span style={{ marginLeft:8, color:C.blue }}>{liveJobs.length} job{liveJobs.length!==1?"s":""}</span>}
                  </div>
                  <LiveJobFeed jobs={liveJobs} />
                </div>
              </div>
            </Section>

            {/* Status snapshot */}
            <Section title="Status snapshot">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                <StatCard label="Pending"   value={fmt(snapshot?.pending)}   color={C.amber} sub="waiting in queue" />
                <StatCard label="Running"   value={fmt(snapshot?.running)}   color={C.blue}  sub="being processed" />
                <StatCard label="Completed" value={fmt(snapshot?.completed)} color={C.green} sub="all time" />
                <StatCard label="Failed"    value={fmt(snapshot?.failed)}    color={C.red}   sub="all time" />
              </div>
            </Section>

            {/* Throughput */}
            <Section title="Throughput">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:12 }}>
                <StatCard label="Last 1 min"  value={fmt(throughput?.last_1_min)}    color={C.cyan} sub="jobs completed" />
                <StatCard label="Last 5 min"  value={fmt(throughput?.last_5_min)}    color={C.cyan} sub="jobs completed" />
                <StatCard label="Last 1 hour" value={fmt(throughput?.last_1_hour)}   color={C.cyan} sub="jobs completed" />
                <StatCard label="Last 24 hrs" value={fmt(throughput?.last_24_hours)} color={C.cyan} sub="jobs completed" />
              </div>
              <ChartCard title="Jobs completed — last hour (per minute)">
                {!chartData.length ? (
                  <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, fontSize:13 }}>
                    Submit jobs to see the throughput chart
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="time" tick={{ fill:C.muted, fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                      <YAxis tick={{ fill:C.muted, fontSize:11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="jobs" stroke={C.cyan} strokeWidth={2} dot={{ fill:C.cyan, r:3 }} activeDot={{ r:5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </Section>

            {/* Failure + Latency */}
            <Section title="Failure rate & latency">
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Failure rate</div>
                  <div style={{ display:"flex", gap:28, marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:30, fontWeight:700, color:failureColor, lineHeight:1.1 }}>{failurePct.toFixed(1)}%</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>last 1 hour</div>
                    </div>
                    <div>
                      <div style={{ fontSize:30, fontWeight:700, color:C.text, lineHeight:1.1 }}>{(failure_rate?.last_24_hours_pct||0).toFixed(1)}%</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>last 24 hours</div>
                    </div>
                  </div>
                  {handlerData.length>0 && (
                    <>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>By handler (24h)</div>
                      {handlerData.map(h => (
                        <div key={h.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:`1px solid ${C.border}`, fontSize:12 }}>
                          <span style={{ fontFamily:"monospace", color:C.text }}>{h.name}</span>
                          <div style={{ display:"flex", gap:12 }}>
                            <span style={{ color:C.muted }}>{h.total} total</span>
                            <span style={{ color:h.failed>0?C.red:C.green }}>{h.failed} failed</span>
                            <span style={{ color:h.pct>5?C.red:h.pct>0?C.amber:C.green, fontWeight:600 }}>{h.pct.toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Processing latency — last 1 hour</div>
                  {[
                    { label:"Average",    value:latency?.avg_ms, color:C.text  },
                    { label:"p50 median", value:latency?.p50_ms, color:C.green },
                    { label:"p95",        value:latency?.p95_ms, color:C.amber },
                    { label:"p99",        value:latency?.p99_ms, color:C.red   },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ marginBottom:14 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:12, color:C.muted }}>{label}</span>
                        <span style={{ fontSize:12, color, fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{fmtMs(value)}</span>
                      </div>
                      <div style={{ height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.min(100,((value||0)/Math.max(latency?.p99_ms||1,1))*100)}%`, background:color, borderRadius:2, transition:"width 0.4s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {/* Handler chart */}
            {handlerData.length>0 && (
              <Section title="Jobs by handler (24h)">
                <ChartCard title="Total vs failed per handler" height={140}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={handlerData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                      <XAxis type="number" tick={{ fill:C.muted, fontSize:11 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fill:C.muted, fontSize:11, fontFamily:"monospace" }} axisLine={false} tickLine={false} width={100} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="total"  name="total"  fill={C.blue} radius={[0,4,4,0]} barSize={10} />
                      <Bar dataKey="failed" name="failed" fill={C.red}  radius={[0,4,4,0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </Section>
            )}
          </>
        )}

        {/* ═══════════════ MONITOR TAB ═══════════════ */}
        {activeTab==="monitor" && (
          <Section title="Task monitor — all jobs">
            <TaskMonitor />
          </Section>
        )}

      </div>
    </div>
  );
}