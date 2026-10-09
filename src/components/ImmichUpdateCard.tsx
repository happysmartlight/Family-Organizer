/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Quản lý Server → thẻ Immich (admin): so phiên bản Immich đang chạy với bản mới
// nhất trên GitHub, bấm để cập nhật. Máy chủ nhờ container family-organizer-updater
// chạy `docker compose pull` + `up -d` cho các service Immich trong cùng stack
// (server/updater.ts + deploy/updater.sh). Không tự cập nhật Immich ban đêm:
// bản mới đôi khi có breaking changes, admin nên đọc ghi chú trước.

import React, { useEffect, useRef, useState } from "react";
import { Images, RefreshCw, ExternalLink, AlertTriangle, CheckCircle, Rocket, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShimmerLine, Reveal, IconChip } from "./Lively.js";
import { useConfirm } from "./ConfirmDialog.js";
import { StepDots } from "./UpdatePanel.js";

interface ImmichOverview {
  status: "ready" | "updater_down" | "updater_old" | "no_immich";
  services: string[];
  running: { version: string | null; error: string | null };
  latest: { version: string; name: string; url: string; publishedAt: string; breaking: boolean } | null;
  updateAvailable: boolean;
  lastCheckAt: number | null;
  lastCheckError: string | null;
  busy: boolean;
  updater: { phase: string; requestId: string | null; action: string | null; result: string | null; message: string | null; finishedAt: number | null };
  lastRequest: { id: string; from: string | null; at: number } | null;
  log: string;
}

interface Run {
  requestId: string;
  from: string | null;
  step: number;
  status: "running" | "done" | "failed";
  error?: string;
  version?: string | null;
}

const IDLE_PHASES = ["idle", "done", "failed", "rolled_back", "unknown"];
const PHASE_STEP: Record<string, number> = { pulling: 0, restarting: 1, health: 2, done: 3 };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function ImmichUpdateCard({ authHeaders, delay = 0 }: { authHeaders: Record<string, string>; delay?: number }) {
  const { t, i18n } = useTranslation();
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState<ImmichOverview | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [showLog, setShowLog] = useState(false);
  const cancelledRef = useRef(false);
  const trackingRef = useRef(false);

  const lang = i18n.resolvedLanguage || "vi";
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtDateTime = (ts: number) =>
    new Date(ts).toLocaleString(lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const api = async <T,>(url: string, method = "GET"): Promise<T> => {
    const res = await fetch(url, { method, headers: authHeaders, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
    return body as T;
  };

  // Theo dõi một lượt cập nhật Immich tới khi updater báo kết quả (app không bị
  // khởi động lại nên API luôn trả lời; Immich migration lâu thì chờ tới 20 phút).
  const track = async (requestId: string) => {
    if (trackingRef.current) return;
    trackingRef.current = true;
    const deadline = Date.now() + 20 * 60 * 1000;
    try {
      while (!cancelledRef.current && Date.now() < deadline) {
        let d: ImmichOverview | null = null;
        try {
          d = await api<ImmichOverview>("/api/system/immich");
        } catch {
          d = null;
        }
        if (cancelledRef.current) return;
        if (d) {
          setData(d);
          const u = d.updater;
          if (u.requestId === requestId && u.finishedAt && u.result) {
            setRun(r =>
              r
                ? u.result === "ok"
                  ? { ...r, step: 3, status: "done", version: d!.running.version }
                  : { ...r, status: "failed", error: u.message || t("serverMonitor.immich.failedTitle") }
                : r
            );
            if (u.result !== "ok") setShowLog(true);
            return;
          }
          const step = u.requestId === requestId ? PHASE_STEP[u.phase] : undefined;
          if (step != null) setRun(r => (r ? { ...r, step: Math.max(r.step, step) } : r));
        }
        await sleep(3000);
      }
      if (!cancelledRef.current) setRun(r => (r && r.status === "running" ? { ...r, status: "failed", error: t("serverMonitor.immich.timeout") } : r));
    } finally {
      trackingRef.current = false;
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    void api<ImmichOverview>("/api/system/immich")
      .then(d => {
        if (cancelledRef.current) return;
        setData(d);
        // Mở lại trang giữa chừng một lượt cập nhật → tiếp tục hiện tiến trình.
        const r = d.lastRequest;
        if (r && d.updater.action === "immich" && d.updater.requestId === r.id && !IDLE_PHASES.includes(d.updater.phase)) {
          setRun({ requestId: r.id, from: r.from, step: PHASE_STEP[d.updater.phase] ?? 0, status: "running" });
          void track(r.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    setCheckErr("");
    try {
      setData(await api<ImmichOverview>("/api/system/immich/check", "POST"));
    } catch (e: any) {
      setCheckErr(e.message);
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    if (!data) return;
    const ok = await confirm({
      title: data.latest && data.updateAvailable
        ? t("serverMonitor.immich.confirmTitle", { version: data.latest.version })
        : t("serverMonitor.immich.confirmTitleUnknown"),
      message: t("serverMonitor.immich.confirmMessage", { services: data.services.join(", ") }),
      confirmLabel: t("serverMonitor.immich.confirmLabel"),
      tone: "default"
    });
    if (!ok) return;
    setShowLog(false);
    try {
      const r = await api<{ requestId: string; from: string | null }>("/api/system/immich/update", "POST");
      setRun({ requestId: r.requestId, from: r.from, step: 0, status: "running" });
      void track(r.requestId);
    } catch (e: any) {
      setRun({ requestId: "", from: null, step: 0, status: "failed", error: e.message });
    }
  };

  // Stack không có Immich (vd bản cài riêng) → không hiện thẻ.
  if (!data || data.status === "no_immich") return null;

  const running = run?.status === "running";
  const u = data.updater;
  const lastImmich = u.action === "immich" && u.finishedAt && !run;
  const steps = [
    t("serverMonitor.immich.stepPull"),
    t("serverMonitor.immich.stepRestart"),
    t("serverMonitor.immich.stepHealth"),
    t("serverMonitor.immich.stepDone")
  ];
  const canUpdate = data.status === "ready" && !data.busy && !running;
  const showButton = data.status === "ready" && !running && (data.updateAvailable || !data.running.version);

  return (
    <Reveal delay={delay} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
      <ShimmerLine accent="cyan" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <IconChip accent="cyan"><Images className="w-4 h-4" /></IconChip> {t("serverMonitor.immich.title")}
          </h4>
          <p className="text-[10px] text-slate-500">{t("serverMonitor.immich.subtitle")}</p>
        </div>
        {data.status === "ready" && (
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking || running}
            className="flex items-center gap-1 bg-slate-950 neu-btn hover:bg-slate-800 text-cyan-400 rounded-lg px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("serverMonitor.immich.checking") : t("serverMonitor.immich.checkNow")}
          </button>
        )}
      </div>

      {data.status === "updater_down" && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t("serverMonitor.immich.updaterDown")}
        </p>
      )}
      {data.status === "updater_old" && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t("serverMonitor.immich.updaterOld")}
        </p>
      )}

      {/* Bản đang chạy / bản mới nhất */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{t("serverMonitor.immich.running")}</p>
          <p className="text-sm font-extrabold text-slate-100 font-mono truncate">
            {data.running.version ? `v${data.running.version}` : t("serverMonitor.immich.unknown")}
          </p>
        </div>
        <div className="bg-slate-950/40 neu-pressed-sm rounded-xl px-3 py-2 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{t("serverMonitor.immich.latest")}</p>
          <p className={`text-sm font-extrabold font-mono truncate ${data.updateAvailable ? "text-sky-400" : "text-slate-100"}`}>
            {data.latest ? `v${data.latest.version}` : "—"}
          </p>
          {data.latest && (
            <p className="text-[10px] text-slate-500 font-mono truncate">
              {t("serverMonitor.immich.published", { date: fmtDate(Date.parse(data.latest.publishedAt)) })}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {!data.running.version && data.running.error ? (
          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t("serverMonitor.immich.runningUnknown", { error: data.running.error })}
          </span>
        ) : data.updateAvailable && data.latest ? (
          <span className="text-sky-400 font-bold flex items-center gap-1.5">
            <Rocket className="w-3.5 h-3.5 shrink-0" /> {t("serverMonitor.immich.newVersion", { version: data.latest.version })}
          </span>
        ) : data.latest ? (
          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {t("serverMonitor.immich.upToDate")}
          </span>
        ) : null}
        {data.latest && (
          <a href={data.latest.url} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline flex items-center gap-1">
            {t("serverMonitor.immich.releaseNotes")} <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <span className="text-[10px] text-slate-500 ml-auto">
          {data.lastCheckAt ? t("serverMonitor.immich.checkedAt", { time: fmtDateTime(data.lastCheckAt) }) : t("serverMonitor.immich.neverChecked")}
        </span>
      </div>
      {(checkErr || data.lastCheckError) && <p className="text-[11px] text-rose-400">{checkErr || data.lastCheckError}</p>}

      {data.updateAvailable && data.latest?.breaking && !run && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-slate-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{t("serverMonitor.immich.breaking")}</span>
        </div>
      )}

      {/* Tiến trình / kết quả lượt cập nhật vừa bấm */}
      {run && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-3 space-y-2.5 ${run.status === "failed" ? "bg-rose-500/10 border-rose-500/25" : run.status === "done" ? "bg-emerald-500/10 border-emerald-500/25" : "bg-sky-500/10 border-sky-500/25"}`}
        >
          <div className="flex items-start gap-2">
            <p className="text-xs font-bold text-slate-100 flex-1">
              {run.status === "failed"
                ? t("serverMonitor.immich.failedTitle")
                : run.status === "done"
                  ? t("serverMonitor.immich.doneTitle")
                  : t("serverMonitor.immich.progressTitle")}
            </p>
            {run.status !== "running" && (
              <button
                type="button"
                onClick={() => setRun(null)}
                aria-label={t("serverMonitor.immich.close")}
                className="p-1 bg-slate-950 neu-btn rounded-lg text-slate-500 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {run.status !== "failed" && <StepDots steps={steps} current={run.step} done={run.status === "done"} />}
          <p className="text-[11px] text-slate-400">
            {run.status === "failed"
              ? run.error
              : run.status === "done"
                ? run.version && run.version === run.from
                  ? t("serverMonitor.immich.doneSame", { version: run.version })
                  : run.version
                    ? t("serverMonitor.immich.doneVersion", { version: run.version })
                    : ""
                : t("serverMonitor.immich.progressHint")}
          </p>
        </div>
      )}

      {showButton && (
        <button
          type="button"
          onClick={handleUpdate}
          disabled={!canUpdate}
          className="w-full sm:w-auto bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
        >
          <Rocket className="w-4 h-4" />
          {data.updateAvailable && data.latest
            ? t("serverMonitor.immich.updateTo", { version: data.latest.version })
            : t("serverMonitor.immich.pullLatest")}
        </button>
      )}
      {data.status === "ready" && data.busy && !running && <p className="text-[11px] text-slate-500">{t("serverMonitor.immich.busy")}</p>}

      {(lastImmich || run?.status === "failed" || run?.status === "done") && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          {lastImmich && (
            <span>
              {u.result === "ok"
                ? t("serverMonitor.immich.lastOk", { time: fmtDateTime(u.finishedAt!) })
                : t("serverMonitor.immich.lastFailed", { time: fmtDateTime(u.finishedAt!) })}
              {u.result !== "ok" && u.message ? ` · ${u.message}` : ""}
            </span>
          )}
          {data.log && (
            <button type="button" onClick={() => setShowLog(s => !s)} className="text-sky-400 hover:underline cursor-pointer ml-auto">
              {showLog ? t("serverMonitor.immich.hideLog") : t("serverMonitor.immich.showLog")}
            </button>
          )}
        </div>
      )}
      {showLog && data.log && (
        <pre className="max-h-64 overflow-auto bg-slate-950/70 neu-pressed-sm rounded-xl p-3 font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all">
          {data.log}
        </pre>
      )}

      {ConfirmDialog}
    </Reveal>
  );
}
