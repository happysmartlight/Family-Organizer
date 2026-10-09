/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Thermometer, MemoryStick, HardDrive, Server, Clock, AlertTriangle, Activity, Network, Globe, Copy, Check, Database, Smartphone, Users as UsersIcon, Wifi, ExternalLink, Plus, Pencil, Trash2, X, Save } from "lucide-react";
import { ShimmerLine, Reveal, IconChip, Accent } from "./Lively.js";
import { User, UserRole } from "../types.js";
import { ImmichUpdateCard } from "./ImmichUpdateCard.js";
import { useTranslation } from "react-i18next";

// Client chỉ tải dữ liệu 1 phút/lần (server cũng tự ghi telemetry 1 phút/lần
// vào SQLite nên biểu đồ giữ nguyên lịch sử qua các lần reload trang).
const POLL_MS = 60 * 1000;

type HistoryRange = "24h" | "7d";

interface NetworkAddr {
  name: string;
  address: string;
  kind: "tailscale" | "docker" | "lan";
}

interface ServerStats {
  at: string;
  hostname: string;
  platform: string;
  uptimeSec: number;
  loadAvg: number[];
  cpu: { percent: number | null; cores: number; model: string };
  tempC: number | null;
  ssdTempC: number | null;
  memory: { totalBytes: number; usedBytes: number; availableBytes: number };
  disk: { totalBytes: number; usedBytes: number; freeBytes: number } | null;
  network?: { interfaces: NetworkAddr[]; clientIp: string };
  app?: { version: string; commit: string; nodeVersion: string; processUptimeSec: number; rssBytes: number };
  data?: { dbBytes: number; uploadsBytes: number; pushDevices: number; sseClients: number; users: number };
}

// Một mẫu telemetry từ DB (server ghi 1 phút/lần).
interface MetricPoint {
  t: number;
  cpu: number | null;
  ram: number | null;
  temp: number | null;
  ssd: number | null;
  disk: number | null;
}

interface HomelabLink {
  id: string;
  emoji: string;
  name: string;
  url: string;
  desc?: string;
}

interface ServerMonitorProps {
  authHeaders: Record<string, string>;
  currentUser?: Pick<User, "role">;
}

const fmtGb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(".", ",") + " GB";
const fmtTemp = (c: number) => c.toFixed(1).replace(".", ",") + "°C";

// Tự chọn đơn vị MB/GB cho dung lượng dữ liệu (DB/media thường vài chục MB).
const fmtBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? fmtGb(bytes) : (bytes / 1024 ** 2).toFixed(1).replace(".", ",") + " MB";

// Sao chép có fallback execCommand — app hay chạy qua http://ip:3001 (non-secure
// context) nên navigator.clipboard có thể không tồn tại.
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* rơi xuống fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Giá trị mono bấm-để-copy, có tick xác nhận 1,5s.
function CopyValue({ value, className = "" }: { value: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
      title={t("serverMonitor.copyTitle")}
      className={`inline-flex items-center gap-1.5 font-mono text-slate-200 hover:text-sky-400 cursor-pointer min-w-0 transition-colors ${className}`}
    >
      <span className="truncate">{value}</span>
      {copied
        ? <Check className="w-3 h-3 text-emerald-400 shrink-0" />
        : <Copy className="w-3 h-3 text-slate-500 shrink-0" />}
    </button>
  );
}

// Nhãn loại địa chỉ IP theo ngữ nghĩa màu.
const ADDR_KIND_BADGE: Record<NetworkAddr["kind"], { label: string; cls: string }> = {
  tailscale: { label: "Tailscale", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  lan: { label: "LAN", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  docker: { label: "Docker", cls: "bg-slate-800 text-slate-400 border-slate-800" }
};

// Ngưỡng màu theo mức độ "nóng" của chỉ số (% hoặc °C).
const levelAccent = (value: number | null, warn: number, danger: number): Accent =>
  value === null ? "sky" : value >= danger ? "rose" : value >= warn ? "amber" : "emerald";

const LEVEL_TEXT: Record<string, string> = {
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
  sky: "text-sky-400"
};
const LEVEL_BAR: Record<string, string> = {
  emerald: "bg-gradient-to-r from-emerald-500 to-emerald-400",
  amber: "bg-gradient-to-r from-amber-500 to-amber-400",
  rose: "bg-gradient-to-r from-rose-500 to-rose-400",
  sky: "bg-gradient-to-r from-sky-500 to-sky-400"
};

// Thanh % dùng chung cho các thẻ chỉ số.
function LevelBar({ pct, accent }: { pct: number; accent: Accent }) {
  return (
    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
      <div
        className={`h-full ${LEVEL_BAR[accent]} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// Nhãn mốc thời gian trục X: 24h hiện giờ:phút, 7 ngày hiện ngày/tháng + giờ.
const fmtTick = (t: number, range: HistoryRange) => {
  const d = new Date(t);
  if (range === "7d") return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}h`;
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
};

interface ChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

function AxisChart({ series, times, yMin, yMax, yTicks, unit, range }: {
  series: ChartSeries[];
  times: number[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  unit: string;
  range: HistoryRange;
}) {
  const W = 420, H = 170;
  const M = { top: 10, right: 10, bottom: 24, left: 38 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const n = times.length;
  const t0 = times[0] ?? 0;
  const t1 = times[n - 1] ?? 1;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => M.left + (n <= 1 ? iw / 2 : ((t - t0) / span) * iw);
  const y = (v: number) => M.top + ih - ((Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin || 1)) * ih;
  const linePoints = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const xTicks = n >= 2 ? [0, 1, 2, 3].map(i => t0 + (i * span) / 3) : [];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {yTicks.map(v => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className="stroke-slate-800" strokeWidth="1" strokeDasharray="3 5" />
          <text x={M.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" className="fill-slate-500 font-mono">
            {v}{unit}
          </text>
        </g>
      ))}
      <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + ih} className="stroke-slate-800" strokeWidth="1.5" />
      <line x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih} className="stroke-slate-800" strokeWidth="1.5" />
      {xTicks.map((t, idx) => (
        <text
          key={idx}
          x={x(t)}
          y={H - 7}
          textAnchor={idx === 0 ? "start" : idx === xTicks.length - 1 ? "end" : "middle"}
          fontSize="10"
          className="fill-slate-500 font-mono"
        >
          {fmtTick(t, range)}
        </text>
      ))}
      {series.map(s => (
        <polyline
          key={s.label}
          points={linePoints(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function ChartCard({ accent, icon, title, legend, children, delay }: {
  accent: Accent;
  icon: React.ReactNode;
  title: string;
  legend: { label: string; color: string; value: string }[];
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <Reveal delay={delay} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-2">
      <ShimmerLine accent={accent} />
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
          <IconChip accent={accent}>{icon}</IconChip> {title}
        </h4>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {legend.map(l => (
            <span key={l.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: l.color }} />
              {l.label} <b className="text-slate-200 font-mono tabular-nums">{l.value}</b>
            </span>
          ))}
        </div>
      </div>
      {children}
    </Reveal>
  );
}

function CollectingHint() {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-xl py-9 text-center">
      <p className="text-xs text-slate-500">{t("serverMonitor.collectingHint")}</p>
    </div>
  );
}

export function ServerMonitor({ authHeaders, currentUser }: ServerMonitorProps) {
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<HistoryRange>("24h");
  const [history, setHistory] = useState<MetricPoint[]>([]);

  // ─── Homelab quick links ─────────────────────────────────────────────────
  const [links, setLinks] = useState<HomelabLink[]>([]);
  const [linkForm, setLinkForm] = useState<{ open: boolean; editing: HomelabLink | null }>({ open: false, editing: null });
  const [lfEmoji, setLfEmoji] = useState("🔗");
  const [lfName, setLfName] = useState("");
  const [lfUrl, setLfUrl] = useState("");
  const [lfDesc, setLfDesc] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const linkFormRef = useRef<HTMLFormElement>(null);

  const fmtUptime = (sec: number) => {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d > 0
      ? t("serverMonitor.uptimeDay", { d, h })
      : h > 0
        ? t("serverMonitor.uptimeHour", { h, m })
        : t("serverMonitor.uptimeMin", { m });
  };

  const fetchLinks = async () => {
    try {
      const res = await fetch("/api/server/homelab-links", { headers: authHeaders });
      if (res.ok) { const d = await res.json(); setLinks(d.links || []); }
    } catch { /* mạng lỗi tạm thời */ }
  };

  const saveLinks = async (newLinks: HomelabLink[]) => {
    const res = await fetch("/api/server/homelab-links", {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ links: newLinks })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || t("serverMonitor.homelabSaving"));
    setLinks(d.links || []);
  };

  const openLinkForm = (link?: HomelabLink) => {
    setLinkForm({ open: true, editing: link || null });
    setLfEmoji(link?.emoji || "🔗");
    setLfName(link?.name || "");
    setLfUrl(link?.url || "");
    setLfDesc(link?.desc || "");
    window.setTimeout(() => linkFormRef.current?.querySelector("input")?.focus(), 50);
  };

  const closeLinkForm = () => setLinkForm({ open: false, editing: null });

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lfName.trim() || !lfUrl.trim() || linkSaving) return;
    setLinkSaving(true);
    try {
      const id = linkForm.editing?.id || `hl_${Date.now()}`;
      const updated = linkForm.editing
        ? links.map(l => l.id === linkForm.editing!.id ? { id, emoji: lfEmoji.trim(), name: lfName.trim(), url: lfUrl.trim(), desc: lfDesc.trim() || undefined } : l)
        : [...links, { id, emoji: lfEmoji.trim() || "🔗", name: lfName.trim(), url: lfUrl.trim(), desc: lfDesc.trim() || undefined }];
      await saveLinks(updated);
      closeLinkForm();
    } finally {
      setLinkSaving(false);
    }
  };

  const handleLinkDelete = async (id: string) => {
    await saveLinks(links.filter(l => l.id !== id));
  };

  useEffect(() => { if (isAdmin) fetchLinks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    const fetchStats = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/server/stats", { headers: authHeaders });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("serverMonitor.statusOffline"));
        if (!alive) return;
        setStats(data);
        setError("");
      } catch (err: any) {
        if (alive) setError(err.message || t("serverMonitor.statusOffline"));
      }
    };
    fetchStats();
    const timer = setInterval(fetchStats, POLL_MS);
    document.addEventListener("visibilitychange", fetchStats);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", fetchStats);
    };
  }, []); // authHeaders ổn định trong một phiên đăng nhập

  useEffect(() => {
    let alive = true;
    const fetchHistory = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/server/history?range=${range}`, { headers: authHeaders });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setHistory(data.points || []);
      } catch { /* lỗi mạng tạm thời — giữ dữ liệu cũ trên biểu đồ */ }
    };
    fetchHistory();
    const timer = setInterval(fetchHistory, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const cpuPct = stats?.cpu.percent ?? null;
  const ramPct = stats ? (stats.memory.usedBytes / stats.memory.totalBytes) * 100 : null;
  const diskPct = stats?.disk ? (stats.disk.usedBytes / stats.disk.totalBytes) * 100 : null;

  const cpuAccent = levelAccent(cpuPct, 60, 85);
  const tempAccent = levelAccent(stats?.tempC ?? null, 60, 75);
  const ramAccent = levelAccent(ramPct, 70, 90);
  const diskAccent = levelAccent(diskPct, 75, 90);

  const times = useMemo(() => history.map(p => p.t), [history]);
  const hasChart = history.length >= 2;

  const tempDomain = useMemo(() => {
    const vals = history.flatMap(p => [p.temp, p.ssd]).filter((v): v is number => v !== null);
    if (vals.length === 0) return { min: 20, max: 80 };
    const min = Math.max(0, Math.floor((Math.min(...vals) - 3) / 10) * 10);
    const max = Math.min(110, Math.ceil((Math.max(...vals) + 3) / 10) * 10);
    return max - min < 20 ? { min: Math.max(0, max - 20), max } : { min, max };
  }, [history]);
  const tempTicks = useMemo(
    () => [0, 1, 2, 3, 4].map(i => Math.round(tempDomain.min + (i * (tempDomain.max - tempDomain.min)) / 4)),
    [tempDomain]
  );

  const pctTicks = [0, 25, 50, 75, 100];

  const skeleton = <span className="inline-block bg-slate-700/40 rounded-md animate-pulse h-8 w-24 align-middle" />;

  const infoChips = useMemo(() => {
    if (!stats) return null;
    return (
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 font-mono"><Server className="w-3.5 h-3.5 text-sky-400" /> {stats.hostname} · {stats.platform}</span>
        <span className="flex items-center gap-1.5 font-mono"><Clock className="w-3.5 h-3.5 text-amber-400" /> Uptime {fmtUptime(stats.uptimeSec)}</span>
        <span className="flex items-center gap-1.5 font-mono"><Activity className="w-3.5 h-3.5 text-emerald-400" /> Load {stats.loadAvg.map(n => n.toFixed(2)).join(" / ")}</span>
      </div>
    );
  }, [stats, t]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6" id="server-monitor-module">
      {/* Header: tên máy, uptime, load + trạng thái LIVE */}
      <Reveal className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-3">
        <ShimmerLine accent="emerald" />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <IconChip accent="emerald"><Server className="w-4 h-4" /></IconChip> {t("serverMonitor.title")}
          </h3>
          {error ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle className="w-3 h-3" /> {t("serverMonitor.statusOffline")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> {t("serverMonitor.statusLive")}
            </span>
          )}
        </div>
        {infoChips}
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </Reveal>

      {/* 4 thẻ chỉ số chính */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-6">
        {/* CPU % */}
        <Reveal delay={0.06} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent={cpuAccent} />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium">CPU</span>
            <IconChip accent={cpuAccent}><Cpu className="w-4 h-4" /></IconChip>
          </div>
          <div>
            {stats ? (
              <span className={`text-2xl md:text-3xl font-extrabold tabular-nums ${LEVEL_TEXT[cpuAccent]}`}>
                {cpuPct === null ? "—" : `${cpuPct.toFixed(0)}%`}
              </span>
            ) : skeleton}
            <p className="text-slate-500 text-[10px] mt-1 truncate">
              {stats
                ? (stats.cpu.model
                  ? t("serverMonitor.cpuCoresModel", { n: stats.cpu.cores, model: stats.cpu.model })
                  : t("serverMonitor.cpuCores", { n: stats.cpu.cores }))
                : t("serverMonitor.reading")}
            </p>
          </div>
          <LevelBar pct={cpuPct ?? 0} accent={cpuAccent} />
        </Reveal>

        {/* Nhiệt độ CPU + SSD */}
        <Reveal delay={0.1} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent={tempAccent} />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium">{t("serverMonitor.tempCpu")}</span>
            <IconChip accent={tempAccent}><Thermometer className="w-4 h-4" /></IconChip>
          </div>
          <div>
            {stats ? (
              <span className={`text-2xl md:text-3xl font-extrabold tabular-nums ${LEVEL_TEXT[tempAccent]}`}>
                {stats.tempC === null ? "—" : fmtTemp(stats.tempC)}
              </span>
            ) : skeleton}
            <p className="text-slate-500 text-[10px] mt-1 font-mono">
              {stats
                ? stats.ssdTempC !== null
                  ? t("serverMonitor.tempSsd", { temp: fmtTemp(stats.ssdTempC) })
                  : stats.tempC === null
                    ? t("serverMonitor.tempNoSensor")
                    : t("serverMonitor.tempNoSsd")
                : t("serverMonitor.reading")}
            </p>
          </div>
          <LevelBar pct={stats?.tempC ? (stats.tempC / 90) * 100 : 0} accent={tempAccent} />
        </Reveal>

        {/* RAM */}
        <Reveal delay={0.14} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent={ramAccent} />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium">RAM</span>
            <IconChip accent={ramAccent}><MemoryStick className="w-4 h-4" /></IconChip>
          </div>
          <div>
            {stats ? (
              <span className={`text-2xl md:text-3xl font-extrabold tabular-nums ${LEVEL_TEXT[ramAccent]}`}>
                {ramPct!.toFixed(0)}%
              </span>
            ) : skeleton}
            <p className="text-slate-500 text-[10px] mt-1 font-mono">
              {stats ? `${fmtGb(stats.memory.usedBytes)} / ${fmtGb(stats.memory.totalBytes)}` : t("serverMonitor.reading")}
            </p>
          </div>
          <LevelBar pct={ramPct ?? 0} accent={ramAccent} />
        </Reveal>

        {/* Ổ đĩa */}
        <Reveal delay={0.18} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent={diskAccent} />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium">{t("serverMonitor.diskLabel")}</span>
            <IconChip accent={diskAccent}><HardDrive className="w-4 h-4" /></IconChip>
          </div>
          <div>
            {stats ? (
              <span className={`text-2xl md:text-3xl font-extrabold tabular-nums ${LEVEL_TEXT[diskAccent]}`}>
                {diskPct === null ? "—" : `${diskPct.toFixed(0)}%`}
              </span>
            ) : skeleton}
            <p className="text-slate-500 text-[10px] mt-1 font-mono">
              {stats?.disk
                ? `${fmtGb(stats.disk.usedBytes)} / ${fmtGb(stats.disk.totalBytes)}`
                : stats
                  ? t("serverMonitor.diskNoData")
                  : t("serverMonitor.reading")}
            </p>
          </div>
          <LevelBar pct={diskPct ?? 0} accent={diskAccent} />
        </Reveal>
      </div>

      {/* Mạng & truy cập + Ứng dụng & dữ liệu */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-6">
        {/* ── Mạng & truy cập ── */}
        <Reveal delay={0.2} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent="sky" />
          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <IconChip accent="sky"><Network className="w-4 h-4" /></IconChip> {t("serverMonitor.networkTitle")}
          </h4>

          <div className="space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
              <span className="flex items-center gap-1.5 text-slate-400 shrink-0"><Globe className="w-3.5 h-3.5 text-sky-400" /> {t("serverMonitor.networkAccessLink")}</span>
              <CopyValue value={window.location.origin} className="text-[11px]" />
            </div>

            {stats?.network && stats.network.interfaces.length > 0 ? (
              stats.network.interfaces.map(ni => {
                const badge = ADDR_KIND_BADGE[ni.kind];
                return (
                  <div key={`${ni.name}_${ni.address}`} className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                    <span className="flex items-center gap-1.5 text-slate-400 min-w-0">
                      <Wifi className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="font-mono truncate">{ni.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg border shrink-0 ${badge.cls}`}>{badge.label}</span>
                    </span>
                    <CopyValue value={ni.address} className="text-[11px]" />
                  </div>
                );
              })
            ) : (
              <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-xl px-3 py-2 text-slate-500">
                {stats ? t("serverMonitor.networkNoInterfaces") : t("serverMonitor.reading")}
              </div>
            )}

            {stats?.network?.clientIp && (
              <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                <span className="flex items-center gap-1.5 text-slate-400 shrink-0"><Smartphone className="w-3.5 h-3.5 text-emerald-400" /> {t("serverMonitor.networkClientIp")}</span>
                <CopyValue value={stats.network.clientIp} className="text-[11px]" />
              </div>
            )}

            {stats?.network && stats.network.interfaces.every(ni => ni.kind === "docker") && (
              <p className="text-[10px] text-slate-500 px-1">{t("serverMonitor.networkDockerNote")}</p>
            )}
          </div>
        </Reveal>

        {/* ── Ứng dụng & dữ liệu ── */}
        <Reveal delay={0.24} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent="indigo" />
          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <IconChip accent="indigo"><Database className="w-4 h-4" /></IconChip> {t("serverMonitor.appTitle")}
          </h4>

          {stats?.app && stats.data ? (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                <span className="text-slate-400">{t("serverMonitor.appVersion")}</span>
                <span className="font-mono text-slate-200">
                  v{stats.app.version}{stats.app.commit ? <span className="text-slate-500"> · {stats.app.commit}</span> : null}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                <span className="text-slate-400">{t("serverMonitor.appProcess")}</span>
                <span className="font-mono text-slate-200">
                  {stats.app.nodeVersion} · {fmtUptime(stats.app.processUptimeSec)} · RAM {fmtBytes(stats.app.rssBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                <span className="text-slate-400">{t("serverMonitor.appData")}</span>
                <span className="font-mono text-slate-200">
                  SQLite {fmtBytes(stats.data.dbBytes)} · Media {fmtBytes(stats.data.uploadsBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2">
                <span className="flex items-center gap-1.5 text-slate-400"><UsersIcon className="w-3.5 h-3.5 text-indigo-400" /> {t("serverMonitor.appConnections")}</span>
                <span className="font-mono text-slate-200">
                  {t("serverMonitor.appConnDetails", { sse: stats.data.sseClients, push: stats.data.pushDevices, users: stats.data.users })}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-xl py-6 text-center text-[11px] text-slate-500">
              {stats ? t("serverMonitor.appOldVersion") : t("serverMonitor.reading")}
            </div>
          )}
        </Reveal>
      </div>

      {/* ─── Dịch vụ Homelab (admin) ─── */}
      {isAdmin && (
        <Reveal delay={0.26} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
          <ShimmerLine accent="violet" />
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <IconChip accent="violet"><Globe className="w-4 h-4" /></IconChip> {t("serverMonitor.homelabTitle")}
            </h4>
            <button type="button" onClick={() => openLinkForm()}
              className="flex items-center gap-1 bg-slate-950 neu-btn hover:bg-slate-800 text-violet-400 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer transition-all">
              <Plus className="w-3.5 h-3.5" /> {t("serverMonitor.homelabAdd")}
            </button>
          </div>

          {linkForm.open && (
            <form ref={linkFormRef} onSubmit={handleLinkSubmit} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-400">{linkForm.editing ? t("serverMonitor.homelabEditTitle") : t("serverMonitor.homelabAddTitle")}</p>
              <div className="grid grid-cols-[56px_1fr_1fr] gap-2 text-xs">
                <input value={lfEmoji} onChange={e => setLfEmoji(e.target.value)} placeholder="📸" maxLength={4}
                  className="bg-slate-900 neu-pressed-sm rounded-xl px-2 py-2 text-slate-200 outline-none focus:border-violet-500 text-center text-lg" />
                <input value={lfName} onChange={e => setLfName(e.target.value)} placeholder={t("serverMonitor.homelabNamePlaceholder")} required
                  className="bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none focus:border-violet-500" />
                <input value={lfDesc} onChange={e => setLfDesc(e.target.value)} placeholder={t("serverMonitor.homelabDescPlaceholder")}
                  className="bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none focus:border-violet-500" />
              </div>
              <div className="flex gap-2">
                <input value={lfUrl} onChange={e => setLfUrl(e.target.value)} placeholder={t("serverMonitor.homelabUrlPlaceholder")} required type="url"
                  className="flex-1 bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-xs font-mono text-slate-200 outline-none focus:border-violet-500 min-w-0" />
                <button type="submit" disabled={linkSaving || !lfName.trim() || !lfUrl.trim()}
                  className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-slate-950 text-xs font-bold px-3.5 py-2 rounded-xl cursor-pointer transition-all shrink-0">
                  <Save className="w-3.5 h-3.5" /> {linkSaving ? t("serverMonitor.homelabSaving") : t("serverMonitor.homelabSave")}
                </button>
                <button type="button" onClick={closeLinkForm}
                  className="p-2 bg-slate-900 neu-btn rounded-xl text-slate-500 hover:text-slate-300 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {links.length === 0 && !linkForm.open ? (
            <p className="text-[11px] text-slate-500 border border-dashed border-slate-800 rounded-xl px-3 py-4 text-center">
              {t("serverMonitor.homelabEmpty")}
            </p>
          ) : links.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {links.map(link => (
                <div key={link.id} className="group relative bg-slate-950/60 neu-pressed-sm hover:border-violet-500/40 rounded-xl p-3 flex flex-col gap-2 transition-colors">
                  <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                    <button type="button" onClick={() => openLinkForm(link)} title={t("serverMonitor.homelabEditBtn")}
                      className="p-1 bg-slate-900 neu-btn rounded-lg text-slate-500 hover:text-sky-400 cursor-pointer">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => handleLinkDelete(link.id)} title={t("serverMonitor.homelabDeleteBtn")}
                      className="p-1 bg-slate-900 neu-btn rounded-lg text-slate-500 hover:text-rose-400 cursor-pointer">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <span className="text-2xl leading-none">{link.emoji}</span>
                    <span className="text-[11px] font-bold text-slate-200 leading-snug">{link.name}</span>
                    {link.desc && <span className="text-[10px] text-slate-500 leading-snug">{link.desc}</span>}
                  </a>

                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-violet-400 truncate transition-colors min-w-0">
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{link.url.replace(/^https?:\/\//, "")}</span>
                  </a>
                </div>
              ))}
            </div>
          )}
        </Reveal>
      )}

      {/* ─── Cập nhật Immich (admin; ẩn nếu stack không có Immich) ─── */}
      {isAdmin && <ImmichUpdateCard authHeaders={authHeaders} delay={0.28} />}

      {/* Chọn khoảng xem lịch sử */}
      <Reveal delay={0.2} className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-slate-500">{t("serverMonitor.historyNote")}</p>
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1 text-[11px] font-bold">
          {(["24h", "7d"] as HistoryRange[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${range === r ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"}`}
            >
              {r === "24h" ? t("serverMonitor.historyRange24h") : t("serverMonitor.historyRange7d")}
            </button>
          ))}
        </div>
      </Reveal>

      {/* 3 biểu đồ: CPU · RAM · Nhiệt độ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6">
        <ChartCard
          accent="emerald"
          icon={<Cpu className="w-3.5 h-3.5" />}
          title={t("serverMonitor.chartCpuTitle")}
          legend={[{ label: "CPU", color: "#34d399", value: cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—" }]}
          delay={0.24}
        >
          {hasChart ? (
            <AxisChart
              series={[{ label: "CPU", color: "#34d399", values: history.map(p => p.cpu) }]}
              times={times}
              yMin={0} yMax={100} yTicks={pctTicks} unit="%" range={range}
            />
          ) : <CollectingHint />}
        </ChartCard>

        <ChartCard
          accent="indigo"
          icon={<MemoryStick className="w-3.5 h-3.5" />}
          title={t("serverMonitor.chartRamTitle")}
          legend={[{ label: "RAM", color: "#818cf8", value: ramPct != null ? `${ramPct.toFixed(0)}%` : "—" }]}
          delay={0.28}
        >
          {hasChart ? (
            <AxisChart
              series={[{ label: "RAM", color: "#818cf8", values: history.map(p => p.ram) }]}
              times={times}
              yMin={0} yMax={100} yTicks={pctTicks} unit="%" range={range}
            />
          ) : <CollectingHint />}
        </ChartCard>

        <ChartCard
          accent="amber"
          icon={<Thermometer className="w-3.5 h-3.5" />}
          title={t("serverMonitor.chartTempTitle")}
          legend={[
            { label: "CPU", color: "#fbbf24", value: stats?.tempC != null ? fmtTemp(stats.tempC) : "—" },
            { label: "SSD", color: "#22d3ee", value: stats?.ssdTempC != null ? fmtTemp(stats.ssdTempC) : "—" }
          ]}
          delay={0.32}
        >
          {hasChart ? (
            <AxisChart
              series={[
                { label: "CPU", color: "#fbbf24", values: history.map(p => p.temp) },
                { label: "SSD", color: "#22d3ee", values: history.map(p => p.ssd) }
              ]}
              times={times}
              yMin={tempDomain.min} yMax={tempDomain.max} yTicks={tempTicks} unit="°" range={range}
            />
          ) : <CollectingHint />}
        </ChartCard>
      </div>
    </div>
  );
}
