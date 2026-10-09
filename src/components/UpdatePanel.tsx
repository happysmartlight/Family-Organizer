/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật.
// Admin: kiểm tra bản mới (GitHub Releases), cập nhật một chạm có tiến trình từng
// bước, quay về bản cũ (kèm khôi phục dữ liệu nếu cần), tự cập nhật ban đêm, xem
// nhật ký dịch vụ cập nhật. Thành viên khác chỉ thấy số phiên bản.
// Phía máy chủ: server/updater.ts + container family-organizer-updater (deploy/updater.sh).

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  Tag,
  Rocket,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  History,
  Terminal,
  Power,
  ChevronDown,
  Moon,
  ShieldCheck,
  ExternalLink,
  Undo2,
  Check,
  X
} from "lucide-react";
import { useConfirm } from "./ConfirmDialog.js";
import { FancySelect } from "./FancySelect.js";
import { ShimmerLine } from "./Lively.js";
import { useModalA11y } from "../hooks/useModalA11y.js";
import { type AppVersionInfo, fetchAppVersion, reloadIntoNewVersion, waitForServer } from "../utils/appVersion.js";

interface Release {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  url: string;
  isCurrent: boolean;
  isNewer: boolean;
}

interface UpdaterState {
  alive: boolean;
  heartbeat: number | null;
  phase: string;
  requestId: string | null;
  result: string | null;
  message: string | null;
  current: string | null;
  previous: string | null;
  finishedAt: number | null;
  scriptVersion: string | null;
}

interface Snapshot {
  name: string;
  createdAt: number;
  sizeKb: number;
  from: string | null;
  to: string | null;
}

interface Overview {
  current: { version: string; commit: string; buildTime: string };
  updater: UpdaterState;
  pending: Record<string, string> | null;
  log: string;
  available: Release | null;
  releases: Release[];
  lastCheckAt: number | null;
  lastCheckError: string | null;
  autoUpdate: boolean;
  autoUpdateHour: number;
  repo: string;
  snapshots: Snapshot[];
  lastRequest: { id: string; from: string; target: string; reason: string; at: number } | null;
}

interface Progress {
  target: string;
  requestId: string | null;
  step: number;
  msg: string;
  status: "running" | "done" | "failed" | "rolled_back";
  error?: string;
  startedAt: number;
}

const PHASE_LABEL: Record<string, string> = {
  idle: "Sẵn sàng",
  prepare: "Chuẩn bị",
  pulling: "Đang tải bản mới",
  restoring: "Đang khôi phục dữ liệu",
  restarting: "Đang khởi động lại",
  health: "Đang kiểm tra bản mới",
  rolling_back: "Bản mới lỗi — đang quay về bản cũ",
  done: "Xong",
  failed: "Thất bại",
  rolled_back: "Đã quay về bản cũ",
  unknown: "Chưa rõ"
};
const IDLE_PHASES = ["idle", "done", "failed", "rolled_back", "unknown"];
const STEPS = ["Sao lưu", "Tải bản mới", "Khởi động lại", "Kiểm tra", "Xong"];
const PHASE_STEP: Record<string, number> = { prepare: 1, pulling: 1, restoring: 1, restarting: 2, health: 3, done: 4 };
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}:00` }));

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("family_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const hasBody = init?.body !== undefined;
  const res = await fetch(url, {
    method: init?.method || "GET",
    headers: { ...authHeaders(), ...(hasBody ? { "Content-Type": "application/json" } : {}) },
    body: hasBody ? JSON.stringify(init!.body) : undefined,
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Lỗi máy chủ (${res.status})`);
  return data as T;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "vừa xong";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// --- Ghi chú phát hành (Markdown rút gọn từ CHANGELOG.md) --------------------

function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <b key={i} className="font-semibold text-slate-200">{part.slice(2, -2)}</b>;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="font-mono text-[10px] bg-slate-950/60 px-1 py-0.5 rounded">{part.slice(1, -1)}</code>;
    }
    return part.replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1$2");
  });
}

function Changelog({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-[11px] text-slate-500">Không có ghi chú.</p>;
  return (
    <div className="space-y-1 text-[11px] text-slate-400 leading-relaxed">
      {text.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith("#")) {
          return <p key={i} className="pt-2 first:pt-0 text-[10px] font-bold uppercase tracking-wider text-slate-300">{t.replace(/^#+\s*/, "")}</p>;
        }
        const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className={`flex gap-2 ${bullet[1].length >= 2 ? "pl-4" : ""}`}>
              <span className="text-sky-400 shrink-0">•</span>
              <span className="min-w-0">{inline(bullet[2])}</span>
            </div>
          );
        }
        return <p key={i}>{inline(t)}</p>;
      })}
    </div>
  );
}

// --- Tiến trình cập nhật -----------------------------------------------------

/** Thanh các bước (dùng chung với thẻ cập nhật Immich ở Quản lý Server). */
export function StepDots({ steps, current, done, ariaLabel = "Các bước cập nhật" }: { steps: string[]; current: number; done: boolean; ariaLabel?: string }) {
  return (
    <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={ariaLabel}>
      {steps.map((label, i) => {
        const state = done || i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={label} className="flex flex-col items-center gap-1 text-center min-w-0">
            <div className="flex items-center w-full">
              <span className={`h-0.5 flex-1 rounded-full ${i === 0 ? "opacity-0" : state === "todo" ? "bg-slate-800" : "bg-emerald-500/60"}`} />
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                  state === "done"
                    ? "bg-emerald-500 text-white"
                    : state === "current"
                      ? "bg-sky-500/15 text-sky-400 ring-2 ring-sky-500/40"
                      : "bg-slate-800 text-slate-500"
                }`}
              >
                {state === "done" ? <Check className="w-3.5 h-3.5" /> : state === "current" ? <RefreshCw className="w-3 h-3 animate-spin" /> : i + 1}
              </span>
              <span className={`h-0.5 flex-1 rounded-full ${i === steps.length - 1 ? "opacity-0" : state === "done" ? "bg-emerald-500/60" : "bg-slate-800"}`} />
            </div>
            <span className={`text-[10px] leading-tight ${state === "current" ? "text-slate-200 font-bold" : "text-slate-500"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ProgressCard({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (progress.status !== "running") return;
    const iv = window.setInterval(() => tick(n => n + 1), 1000);
    return () => window.clearInterval(iv);
  }, [progress.status]);

  const failed = progress.status === "failed" || progress.status === "rolled_back";
  const done = progress.status === "done";
  const tone = failed
    ? "bg-rose-500/10 border-rose-500/25"
    : done
      ? "bg-emerald-500/10 border-emerald-500/25"
      : "bg-sky-500/10 border-sky-500/25";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-3.5 space-y-3 ${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${failed ? "bg-rose-500/15 text-rose-400" : done ? "bg-emerald-500/15 text-emerald-400" : "bg-sky-500/15 text-sky-400"}`}
        >
          {failed ? <AlertTriangle className="w-4.5 h-4.5" /> : done ? <CheckCircle className="w-4.5 h-4.5" /> : <RefreshCw className="w-4.5 h-4.5 animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-100">
            {progress.status === "rolled_back"
              ? `Bản v${progress.target} lỗi — đã quay về bản cũ`
              : failed
                ? `Cập nhật v${progress.target} không thành công`
                : done
                  ? `Đã lên v${progress.target}`
                  : `Đang cập nhật lên v${progress.target}`}
          </p>
          <p className="text-[11px] text-slate-400">
            {progress.status === "rolled_back"
              ? "Dữ liệu đã được khôi phục về lúc trước khi cập nhật. Xem nhật ký dịch vụ cập nhật bên dưới để biết lỗi."
              : failed
                ? progress.error
                : progress.msg}
          </p>
        </div>
        {progress.status === "running" ? (
          <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">{fmtElapsed(Date.now() - progress.startedAt)}</span>
        ) : failed ? (
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-1.5 bg-slate-950 neu-btn rounded-lg text-slate-500 hover:text-slate-200 cursor-pointer shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {!failed && (
        <StepDots steps={STEPS} current={progress.step} done={done} />
      )}

      {progress.status === "running" && (
        <p className="text-[10px] text-slate-500">Đừng đóng trang. App tạm ngưng khoảng 1–2 phút trong lúc khởi động lại.</p>
      )}
    </motion.div>
  );
}

// --- Panel chính ---------------------------------------------------------------

export function UpdatePanel({ isAdmin }: { isAdmin: boolean }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [basic, setBasic] = useState<AppVersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [rollback, setRollback] = useState<Release | null>(null);
  const [restoreData, setRestoreData] = useState(false);
  const [restoreName, setRestoreName] = useState("");
  const [openVersion, setOpenVersion] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoErr, setAutoErr] = useState("");
  const [restartState, setRestartState] = useState<"" | "busy" | "waiting">("");
  const [restartErr, setRestartErr] = useState("");
  const cancelledRef = useRef(false);
  const trackingRef = useRef(false);
  const logRef = useRef<HTMLPreElement>(null);
  const rollbackRef = useRef<HTMLDivElement>(null);
  useModalA11y(!!rollback, () => setRollback(null), rollbackRef);

  const load = async (): Promise<Overview | null> => {
    try {
      const d = await api<Overview>("/api/system/update");
      if (!cancelledRef.current) {
        setData(d);
        setLoadError("");
      }
      return d;
    } catch (e: any) {
      if (!cancelledRef.current) setLoadError(e.message || "Không tải được thông tin cập nhật.");
      return null;
    }
  };

  // Theo dõi một lượt cập nhật tới khi máy chủ chạy bản đích (hoặc updater báo lỗi).
  // Chịu được lúc máy chủ khởi động lại (mọi request đều lỗi trong ~1 phút).
  const track = async (target: string, requestId: string | null) => {
    if (trackingRef.current) return;
    trackingRef.current = true;
    const deadline = Date.now() + 10 * 60 * 1000;
    try {
      while (!cancelledRef.current && Date.now() < deadline) {
        const v = await fetchAppVersion();
        if (v && v.version === target) {
          setProgress(p => (p ? { ...p, step: 4, status: "done", msg: `Đã lên v${target}. Đang tải lại ứng dụng…` } : p));
          window.setTimeout(() => void reloadIntoNewVersion(), 1500);
          return;
        }
        let ov: Overview | null = null;
        try {
          ov = await api<Overview>("/api/system/update");
        } catch {
          ov = null;
        }
        if (cancelledRef.current) return;
        if (ov) {
          setData(ov);
          const u = ov.updater;
          if (requestId && u.requestId === requestId && u.finishedAt && u.result && u.result !== "ok") {
            setProgress(p =>
              p ? { ...p, status: u.result === "rolled_back" ? "rolled_back" : "failed", error: u.message || "Cập nhật thất bại." } : p
            );
            return;
          }
          const step = PHASE_STEP[u.phase];
          setProgress(p => {
            if (!p) return p;
            if (u.phase === "rolling_back") return { ...p, msg: PHASE_LABEL.rolling_back };
            if (step != null) return { ...p, step: Math.max(p.step, step), msg: PHASE_LABEL[u.phase] };
            return p;
          });
        } else {
          setProgress(p => (p ? { ...p, step: Math.max(p.step, 2), msg: "Máy chủ đang khởi động lại…" } : p));
        }
        await sleep(2500);
      }
      if (!cancelledRef.current) {
        setProgress(p =>
          p && p.status === "running" ? { ...p, status: "failed", error: "Quá thời gian chờ. Xem nhật ký dịch vụ cập nhật bên dưới." } : p
        );
      }
    } finally {
      trackingRef.current = false;
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    if (!isAdmin) {
      void fetchAppVersion().then(v => !cancelledRef.current && setBasic(v));
      return () => {
        cancelledRef.current = true;
      };
    }
    void load().then(d => {
      // Mở lại trang giữa chừng một lượt cập nhật → tiếp tục hiện tiến trình.
      const r = d?.lastRequest;
      if (!d || !r) return;
      const running = d.updater.requestId === r.id && !IDLE_PHASES.includes(d.updater.phase);
      const queued = d.pending?.id === r.id;
      if (running || queued) {
        setProgress({ target: r.target, requestId: r.id, step: PHASE_STEP[d.updater.phase] ?? 1, msg: PHASE_LABEL[d.updater.phase] || "Đang chờ dịch vụ cập nhật…", status: "running", startedAt: r.at });
        void track(r.target, r.id);
      }
    });
    const iv = window.setInterval(() => {
      if (!trackingRef.current) void load();
    }, 15_000);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [showLog, data?.log]);

  const run = async (target: string, restoreSnapshot: string | null) => {
    setCheckMsg(null);
    setProgress({ target, requestId: null, step: 0, msg: "Đang sao lưu dữ liệu…", status: "running", startedAt: Date.now() });
    try {
      const r = await api<{ requestId: string }>("/api/system/update/apply", { method: "POST", body: { version: target, restoreSnapshot } });
      setProgress(p => (p ? { ...p, requestId: r.requestId, step: 1, msg: "Đã sao lưu. Chờ dịch vụ cập nhật nhận việc…" } : p));
      await track(target, r.requestId);
    } catch (e: any) {
      setProgress(p => (p ? { ...p, status: "failed", error: e.message || "Không bắt đầu cập nhật được." } : p));
      void load();
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await api<{ available: Release | null }>("/api/system/update/check", { method: "POST" });
      setCheckMsg(r.available ? { ok: true, text: `Có bản mới v${r.available.version}.` } : { ok: true, text: "Bạn đang dùng bản mới nhất." });
    } catch (e: any) {
      setCheckMsg({ ok: false, text: e.message || "Không kiểm tra được bản mới." });
    } finally {
      setChecking(false);
      void load();
    }
  };

  const saveAuto = async (autoUpdate: boolean, autoUpdateHour: number) => {
    setAutoBusy(true);
    setAutoErr("");
    try {
      await api("/api/system/update/config", { method: "PUT", body: { autoUpdate, autoUpdateHour } });
      setData(d => (d ? { ...d, autoUpdate, autoUpdateHour } : d));
    } catch (e: any) {
      setAutoErr(e.message || "Không lưu được.");
    } finally {
      setAutoBusy(false);
    }
  };

  const handleRestart = async () => {
    const ok = await confirm({
      title: "Khởi động lại app?",
      message: "App tạm ngưng khoảng 30 giây rồi tự tải lại trang.",
      confirmLabel: "Khởi động lại",
      tone: "default"
    });
    if (!ok) return;
    setRestartErr("");
    setRestartState("busy");
    try {
      await api("/api/system/restart", { method: "POST" });
      setRestartState("waiting");
      await sleep(5000);
      if (await waitForServer()) await reloadIntoNewVersion();
      else setRestartErr("App chưa phản hồi lại. Thử tải lại trang sau ít phút.");
    } catch (e: any) {
      setRestartErr(e.message || "Không gửi được yêu cầu khởi động lại.");
    } finally {
      setRestartState("");
    }
  };

  const askUpdate = async (r: Release) => {
    const ok = await confirm({
      title: `Cập nhật lên v${r.version}?`,
      message: "App tự sao lưu dữ liệu rồi khởi động lại (tạm ngưng 1–2 phút). Nếu bản mới lỗi, app tự quay về bản đang chạy.",
      confirmLabel: "Cập nhật",
      tone: "default"
    });
    if (ok) void run(r.version, null);
  };

  const openRollback = (r: Release) => {
    setRestoreData(false);
    setRestoreName(data?.snapshots[0]?.name ?? "");
    setRollback(r);
  };

  // ── Thành viên không phải admin: chỉ xem số phiên bản ──
  if (!isAdmin) {
    return (
      <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-0.5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Tag className="w-4 h-4 text-sky-400" /> Phiên bản ứng dụng
        </h3>
        <p className="text-[11px] text-slate-500 font-mono">
          {basic ? `v${basic.version}${basic.buildTime ? ` • build ${fmtDateTime(Date.parse(basic.buildTime))}` : ""}` : "Đang tải thông tin phiên bản…"}
        </p>
      </div>
    );
  }

  const u = data?.updater;
  const busy = !!data && (!!data.pending || !IDLE_PHASES.includes(data.updater.phase));
  const running = progress?.status === "running";
  const canAct = !!u?.alive && !busy && !running;
  const available = data?.available ?? null;

  return (
    <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Tag className="w-4 h-4 text-sky-400" /> Phiên bản & Cập nhật
        </h3>
        <p className="text-[11px] text-slate-500">
          Cập nhật một chạm từ bản phát hành trên GitHub. Trước mỗi lần cập nhật app tự sao lưu dữ liệu; bản mới khởi động lỗi sẽ tự quay về bản cũ.
        </p>
      </div>

      {!data ? (
        <p className={`text-[11px] ${loadError ? "text-rose-400" : "text-slate-500"}`}>{loadError || "Đang tải thông tin phiên bản…"}</p>
      ) : (
        <>
          {/* Bản đang chạy + kiểm tra bản mới */}
          <div className="relative overflow-hidden bg-slate-900 neu-flat rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
            <ShimmerLine accent="sky" />
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="w-11 h-11 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Đang chạy</p>
                <p className="text-xl font-extrabold text-slate-100 font-mono leading-tight">v{data.current.version}</p>
                <p className="text-[10px] text-slate-500 font-mono truncate">
                  {data.current.commit ? `commit ${data.current.commit.slice(0, 7)}` : "bản dev"}
                  {data.current.buildTime ? ` • build ${fmtDateTime(Date.parse(data.current.buildTime))}` : ""}
                </p>
              </div>
            </div>
            <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1">
              <button
                type="button"
                onClick={handleCheck}
                disabled={checking}
                className="bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
                {checking ? "Đang kiểm tra…" : "Kiểm tra bản mới"}
              </button>
              <p className="text-[10px] text-slate-500">{data.lastCheckAt ? `Kiểm tra ${relTime(data.lastCheckAt)}` : "Chưa kiểm tra lần nào"}</p>
            </div>
          </div>

          {checkMsg ? (
            <p className={`text-[11px] flex items-center gap-1.5 ${checkMsg.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {checkMsg.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />} {checkMsg.text}
            </p>
          ) : data.lastCheckError ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Lần kiểm tra gần nhất lỗi: {data.lastCheckError}
            </p>
          ) : null}

          {/* Dịch vụ cập nhật chưa chạy → hướng dẫn cài một lần */}
          {!u?.alive && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-slate-300 space-y-1.5">
              <p className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Dịch vụ cập nhật chưa chạy
              </p>
              <p>
                Nút cập nhật cần container <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono">family-organizer-updater</code> chạy cạnh app. Cài một lần trên máy chủ:
              </p>
              <ul className="space-y-1 pl-1">
                <li>
                  • Stack liu-homelab:{" "}
                  <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono break-all">cd ~/liu-homelab && git pull && sudo bash setup.sh</code>
                </li>
                <li>
                  • Cài riêng: thêm <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono">STACK_DIR=&lt;thư mục chứa docker-compose.yml&gt;</code> vào{" "}
                  <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono">.env</code>, rồi{" "}
                  <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono break-all">docker compose up -d --remove-orphans</code>
                </li>
              </ul>
            </div>
          )}

          {progress && <ProgressCard progress={progress} onClose={() => setProgress(null)} />}

          {/* Có bản mới */}
          {available && !progress && (
            <div className="relative overflow-hidden bg-slate-900 neu-flat rounded-xl p-3.5 space-y-3">
              <ShimmerLine accent="emerald" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    <Rocket className="w-4 h-4 text-emerald-400" /> Có bản mới v{available.version}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">Phát hành {fmtDate(Date.parse(available.publishedAt))}</p>
                </div>
                <a href={available.url} target="_blank" rel="noreferrer noopener" className="text-[10px] text-sky-400 hover:underline flex items-center gap-1 shrink-0">
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="bg-slate-950/40 neu-pressed-sm rounded-xl p-3 max-h-64 overflow-y-auto">
                <Changelog text={available.notes} />
              </div>
              <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-400" /> Tự sao lưu dữ liệu trước khi cập nhật · bản mới lỗi sẽ tự quay về v{data.current.version}.
              </p>
              <button
                type="button"
                onClick={() => askUpdate(available)}
                disabled={!canAct}
                className="w-full sm:w-auto bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
              >
                <Rocket className="w-4 h-4" /> Cập nhật ngay
              </button>
            </div>
          )}

          {/* Tự cập nhật ban đêm */}
          <div className="bg-slate-900 neu-flat rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Moon className="w-4 h-4 text-violet-400" /> Tự cập nhật ban đêm
              </p>
              <p className="text-[10px] text-slate-500">Có bản mới thì tự cài vào giờ đã chọn. Báo qua Telegram (nếu đã cấu hình) khi bắt đầu và khi xong.</p>
              {autoErr && <p className="text-[11px] text-rose-400">{autoErr}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-24">
                <FancySelect
                  value={String(data.autoUpdateHour)}
                  onChange={v => void saveAuto(data.autoUpdate, Number(v))}
                  options={HOUR_OPTIONS}
                  ariaLabel="Giờ tự cập nhật"
                />
              </div>
              <button
                type="button"
                onClick={() => void saveAuto(!data.autoUpdate, data.autoUpdateHour)}
                disabled={autoBusy}
                title={data.autoUpdate ? "Đang BẬT tự cập nhật — bấm để tắt" : "Đang TẮT — bấm để bật tự cập nhật"}
                className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors disabled:opacity-60 ${data.autoUpdate ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-950 text-slate-500 border-slate-800"}`}
              >
                {data.autoUpdate ? "ĐANG BẬT" : "ĐANG TẮT"}
              </button>
            </div>
          </div>

          {/* Các phiên bản */}
          <div className="bg-slate-900 neu-flat rounded-xl overflow-hidden">
            <div className="px-3.5 pt-3 pb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <History className="w-4 h-4 text-amber-400" /> Các phiên bản
              </p>
              <a
                href={`https://github.com/${data.repo}/releases`}
                target="_blank"
                rel="noreferrer noopener"
                title={`github.com/${data.repo}`}
                className="text-[10px] text-sky-400 hover:underline flex items-center gap-1 shrink-0"
              >
                GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {data.releases.length === 0 ? (
              <p className="px-3.5 pb-3.5 text-[11px] text-slate-500">Chưa có thông tin phiên bản. Bấm "Kiểm tra bản mới".</p>
            ) : (
              <ul className="divide-y divide-slate-850">
                {data.releases.map(r => {
                  const open = openVersion === r.version;
                  return (
                    <li key={r.version}>
                      <div className="flex items-center gap-2 px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => setOpenVersion(open ? null : r.version)}
                          aria-expanded={open}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/40 rounded-lg"
                        >
                          <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-200 font-mono">v{r.version}</span>
                              {r.isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-lg border font-semibold bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Đang chạy</span>}
                              {r.isNewer && <span className="text-[10px] px-2 py-0.5 rounded-lg border font-semibold bg-sky-500/10 text-sky-400 border-sky-500/20">Mới hơn</span>}
                              {r.prerelease && <span className="text-[10px] px-2 py-0.5 rounded-lg border font-semibold bg-amber-500/10 text-amber-400 border-amber-500/20">Thử nghiệm</span>}
                            </span>
                            <span className="block text-[10px] text-slate-500 font-mono">{fmtDate(Date.parse(r.publishedAt))}</span>
                          </span>
                        </button>
                        {!r.isCurrent && (
                          <button
                            type="button"
                            disabled={!canAct}
                            onClick={() => (r.isNewer ? void askUpdate(r) : openRollback(r))}
                            className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors ${r.isNewer ? "bg-indigo-500 hover:bg-indigo-400 text-white" : "bg-slate-800 hover:bg-slate-700 text-slate-300"}`}
                          >
                            {r.isNewer ? <Rocket className="w-3.5 h-3.5" /> : <Undo2 className="w-3.5 h-3.5" />}
                            {r.isNewer ? "Cập nhật" : "Quay về"}
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="px-3.5 pb-3">
                          <div className="bg-slate-950/40 neu-pressed-sm rounded-xl p-3">
                            <Changelog text={r.notes} />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Dịch vụ cập nhật */}
          <div className="bg-slate-900 neu-flat rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-slate-400" /> Dịch vụ cập nhật
                  <span className={`w-2 h-2 rounded-full ${u?.alive ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} aria-hidden />
                </p>
                <p className="text-[10px] text-slate-500">
                  {u?.alive
                    ? `${PHASE_LABEL[u.phase] ?? u.phase} · tín hiệu ${u.heartbeat ? relTime(u.heartbeat) : "—"}`
                    : u?.heartbeat
                      ? `Không chạy · tín hiệu cuối ${relTime(u.heartbeat)}`
                      : "Không chạy"}
                </p>
                {u?.result && (
                  <p className="text-[10px] text-slate-400">
                    Lần gần nhất:{" "}
                    <b className={u.result === "ok" ? "text-emerald-600 dark:text-emerald-400" : u.result === "rolled_back" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}>
                      {u.result === "ok" ? "thành công" : u.result === "rolled_back" ? "lỗi, đã quay về bản cũ" : "thất bại"}
                    </b>
                    {u.finishedAt ? ` · ${fmtDateTime(u.finishedAt)}` : ""}
                    {u.message ? ` · ${u.message}` : ""}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setShowLog(s => !s)} className="text-[11px] text-sky-400 hover:underline cursor-pointer shrink-0">
                {showLog ? "Ẩn nhật ký" : "Xem nhật ký"}
              </button>
            </div>
            {showLog && (
              <pre
                ref={logRef}
                className="max-h-72 overflow-auto bg-slate-950/70 neu-pressed-sm rounded-xl p-3 font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all"
              >
                {data.log || "(trống)"}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRestart}
                disabled={!canAct || restartState !== ""}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <Power className="w-3.5 h-3.5" />
                {restartState === "busy" ? "Đang gửi yêu cầu…" : restartState === "waiting" ? "Đang khởi động lại…" : "Khởi động lại app"}
              </button>
              {restartErr && <span className="text-[11px] text-rose-400">{restartErr}</span>}
            </div>
          </div>
        </>
      )}

      {/* Hộp thoại quay về bản cũ — portal ra body: Settings nằm trong khối có transform (Reveal) */}
      {rollback && data && createPortal(
        <div onClick={() => setRollback(null)} className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            ref={rollbackRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl shrink-0 bg-amber-500/10 text-amber-400">
                  <Undo2 className="w-5 h-5" />
                </div>
                <h3 className="text-md font-bold text-slate-100 leading-snug">Quay về v{rollback.version}?</h3>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setRollback(null)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Dùng khi bản đang chạy có lỗi. Dữ liệu nhập sau khi cập nhật vẫn được giữ, trừ khi chọn khôi phục dữ liệu bên dưới.
            </p>
            <label className={`flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/40 neu-pressed-sm ${data.snapshots.length ? "cursor-pointer" : "opacity-60"}`}>
              <input
                type="checkbox"
                checked={restoreData}
                disabled={!data.snapshots.length}
                onChange={e => setRestoreData(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-rose-500 shrink-0"
              />
              <span className="space-y-0.5">
                <span className="block text-xs font-bold text-slate-200">Khôi phục cả dữ liệu về lúc trước khi cập nhật</span>
                <span className="block text-[10px] text-slate-500">
                  {data.snapshots.length
                    ? "Chỉ chọn khi bản mới làm hỏng dữ liệu. Mọi thứ nhập sau thời điểm sao lưu sẽ mất."
                    : "Chưa có bản sao lưu trước cập nhật nào."}
                </span>
              </span>
            </label>
            {restoreData && (
              <FancySelect
                value={restoreName}
                onChange={setRestoreName}
                ariaLabel="Bản sao lưu để khôi phục"
                options={data.snapshots.map(s => ({
                  value: s.name,
                  label: `${fmtDateTime(s.createdAt)}${s.from && s.to ? ` · v${s.from} → v${s.to}` : ""} · ${s.sizeKb} KB`
                }))}
              />
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRollback(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold cursor-pointer">
                Hủy
              </button>
              <button
                type="button"
                disabled={restoreData && !restoreName}
                onClick={() => {
                  const target = rollback.version;
                  setRollback(null);
                  void run(target, restoreData ? restoreName : null);
                }}
                className="bg-rose-500 hover:bg-rose-400 text-white rounded-xl px-4 py-2.5 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Undo2 className="w-4 h-4" /> Quay về
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {ConfirmDialog}
    </div>
  );
}
