/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Quản lý Server → "Ứng dụng trong nhà" (admin): Family Organizer làm trung tâm điều
// khiển cho các app tự host ở stack riêng (Car Rental, KidTube). Cập nhật qua API của
// chính app đó (app tự sao lưu + tự quay về), khởi động lại qua family-organizer-updater,
// và xem trạng thái mọi container mà updater đang trông chừng (server/apps.ts).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, ExternalLink, RefreshCw, Rocket, RotateCw, AlertTriangle, CheckCircle, Wrench, X, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShimmerLine, Reveal, IconChip } from "./Lively.js";
import { useConfirm } from "./ConfirmDialog.js";

interface ContainerStatus {
  name: string;
  project: string | null;
  service: string | null;
  status: string;
  health: string | null;
  problem: string;
}

interface AppUpdateInfo {
  current: string | null;
  available: { version: string | null; title: string; notes: string; url: string | null; commits: { short: string; subject: string }[] } | null;
  checkedAt: number | null;
  checkError: string | null;
  updaterOnline: boolean;
  busy: boolean;
  phase: string;
  last: { ok: boolean; message: string | null; at: number | null } | null;
  blockers: string[];
  warnings: string[];
  log: string;
}

interface ManagedApp {
  id: string;
  name: string;
  kind: "release" | "git";
  publicUrl: string;
  container: ContainerStatus | null;
  health: { ok: boolean; version: string | null; error: string | null };
  control: "ok" | "no_token" | "unauthorized" | "unreachable" | "error";
  controlError: string | null;
  update: AppUpdateInfo | null;
  canRestart: boolean;
}

interface AppsOverview {
  apps: ManagedApp[];
  watch: { checkedAt: number | null; stale: boolean; enabled: boolean; containers: ContainerStatus[]; heals: { at: number; container: string; problem: string; ok: boolean }[] };
  updater: { alive: boolean; phase: string; action: string | null; requestId: string | null; result: string | null; message: string | null; finishedAt: number | null };
}

interface Run {
  kind: "update" | "restart";
  startedAt: number;
  requestId?: string;
  status: "running" | "done" | "failed";
  message?: string | null;
}

// Cập nhật KidTube build lại trên Pi → có thể mất nhiều phút.
const RUN_TIMEOUT_MS = { update: 20 * 60 * 1000, restart: 5 * 60 * 1000 };
const BAD_PROBLEMS = ["no_network", "no_ports", "start_failed", "unhealthy", "restarting"];

export function HomelabAppsCard({ authHeaders, delay = 0 }: { authHeaders: Record<string, string>; delay?: number }) {
  const { t, i18n } = useTranslation();
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState<AppsOverview | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const lang = i18n.resolvedLanguage || "vi";
  const fmtDateTime = (ts: number) => new Date(ts).toLocaleString(lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const api = useCallback(
    async <T,>(url: string, method = "GET", body?: unknown): Promise<T> => {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { ...authHeaders, "Content-Type": "application/json" } : authHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store"
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any).error || `HTTP ${res.status}`);
      return json as T;
    },
    [authHeaders]
  );

  // Kết thúc lượt đang theo dõi khi app/updater báo xong.
  const settle = (d: AppsOverview) =>
    setRuns(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [id, r] of Object.entries(prev)) {
        if (r.status !== "running") continue;
        let done: Run | null = null;
        if (Date.now() - r.startedAt > RUN_TIMEOUT_MS[r.kind]) {
          done = { ...r, status: "failed", message: t("serverMonitor.apps.timeout") };
        } else if (r.kind === "restart") {
          const u = d.updater;
          if (u.requestId === r.requestId && u.finishedAt && u.result) done = { ...r, status: u.result === "ok" ? "done" : "failed", message: u.message };
        } else {
          const up = d.apps.find(a => a.id === id)?.update;
          if (up && !up.busy && up.last?.at && up.last.at >= r.startedAt - 5000) done = { ...r, status: up.last.ok ? "done" : "failed", message: up.last.message };
        }
        if (done) {
          next[id] = done;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

  const load = useCallback(async () => {
    try {
      const d = await api<AppsOverview>("/api/system/apps");
      if (!aliveRef.current) return;
      setData(d);
      settle(d);
    } catch {
      /* lần sau thử lại */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const anyRunning = Object.values(runs).some(r => r.status === "running");
  useEffect(() => {
    aliveRef.current = true;
    void load();
    const timer = setInterval(() => void load(), anyRunning ? 3000 : 60 * 1000);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load, anyRunning]);

  const setErr = (id: string, msg: string) => setErrors(e => ({ ...e, [id]: msg }));

  const handleCheck = async (app: ManagedApp) => {
    setChecking(app.id);
    setErr(app.id, "");
    try {
      await api(`/api/system/apps/${app.id}/check`, "POST");
      await load();
    } catch (e: any) {
      setErr(app.id, e.message);
    } finally {
      setChecking(null);
    }
  };

  const handleUpdate = async (app: ManagedApp) => {
    const av = app.update?.available;
    if (!av) return;
    const warnings = app.update?.warnings ?? [];
    const ok = await confirm({
      title: av.version
        ? t("serverMonitor.apps.confirmUpdateTitle", { name: app.name, version: av.version })
        : t("serverMonitor.apps.confirmUpdateGitTitle", { name: app.name }),
      message: [t(app.kind === "release" ? "serverMonitor.apps.confirmUpdateRelease" : "serverMonitor.apps.confirmUpdateGit", { name: app.name }), ...warnings].join("\n"),
      confirmLabel: t("serverMonitor.apps.confirmUpdateLabel"),
      tone: warnings.length ? "danger" : "default"
    });
    if (!ok) return;
    setErr(app.id, "");
    const startedAt = Date.now();
    try {
      await api(`/api/system/apps/${app.id}/update`, "POST", { version: av.version });
      setRuns(r => ({ ...r, [app.id]: { kind: "update", startedAt, status: "running" } }));
    } catch (e: any) {
      setErr(app.id, e.message);
    }
  };

  const handleRestart = async (app: ManagedApp) => {
    const ok = await confirm({
      title: t("serverMonitor.apps.confirmRestartTitle", { name: app.name }),
      message: t("serverMonitor.apps.confirmRestartMessage", { name: app.name }),
      confirmLabel: t("serverMonitor.apps.restart"),
      tone: "default"
    });
    if (!ok) return;
    setErr(app.id, "");
    try {
      const r = await api<{ requestId: string }>(`/api/system/apps/${app.id}/restart`, "POST");
      setRuns(prev => ({ ...prev, [app.id]: { kind: "restart", startedAt: Date.now(), requestId: r.requestId, status: "running" } }));
    } catch (e: any) {
      setErr(app.id, e.message);
    }
  };

  if (!data || (!data.apps.length && !data.watch.containers.length)) return null;

  const problemText = (p: string) => (t(`serverMonitor.apps.problem.${p}`, { defaultValue: p }) as string);
  const bad = data.watch.containers.filter(c => BAD_PROBLEMS.includes(c.problem));
  const listed = showAll ? data.watch.containers : bad;
  const updaterBusy = data.updater.alive && !["idle", "done", "failed", "rolled_back", "unknown"].includes(data.updater.phase);

  const statusBadge = (app: ManagedApp, run?: Run) => {
    const badge = (cls: string, text: string, pulse = false) => (
      <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-lg border ${cls}`}>
        <span className={`size-1.5 rounded-full bg-current inline-block ${pulse ? "animate-pulse" : ""}`} /> {text}
      </span>
    );
    if (run?.status === "running")
      return badge("bg-sky-500/10 text-sky-400 border-sky-500/20", t(run.kind === "update" ? "serverMonitor.apps.statusUpdating" : "serverMonitor.apps.statusRestarting"), true);
    const c = app.container;
    if (c && BAD_PROBLEMS.includes(c.problem)) return badge("bg-rose-500/10 text-rose-400 border-rose-500/20", problemText(c.problem));
    if (c && c.problem === "stopped") return badge("bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", problemText("stopped"));
    if (!app.health.ok) return badge("bg-rose-500/10 text-rose-400 border-rose-500/20", t("serverMonitor.apps.statusDown"));
    if (c?.health === "starting") return badge("bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", t("serverMonitor.apps.statusStarting"), true);
    return badge("bg-emerald-500/10 text-emerald-400 border-emerald-500/20", t("serverMonitor.apps.statusOk"), true);
  };

  return (
    <Reveal delay={delay} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 space-y-3">
      <ShimmerLine accent="emerald" />
      <div className="min-w-0 space-y-0.5">
        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
          <IconChip accent="emerald"><Boxes className="w-4 h-4" /></IconChip> {t("serverMonitor.apps.title")}
        </h4>
        <p className="text-[10px] text-slate-500">{t("serverMonitor.apps.subtitle")}</p>
      </div>

      {!data.updater.alive && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t("serverMonitor.apps.updaterDown")}
        </p>
      )}

      {/* Từng app */}
      {data.apps.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.apps.map(app => {
            const up = app.update;
            const run = runs[app.id];
            const running = run?.status === "running";
            const av = up?.available ?? null;
            const canUpdate = !!av && !!up && !up.busy && !up.blockers.length && !running;
            return (
              <div key={app.id} className="bg-slate-950/40 neu-pressed-sm rounded-xl p-3 space-y-2.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-bold text-slate-100 truncate">{app.name}</p>
                  {statusBadge(app, run)}
                  {app.publicUrl && (
                    <a
                      href={app.publicUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:underline shrink-0"
                    >
                      {t("serverMonitor.apps.open")} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{t("serverMonitor.apps.running")}</p>
                    <p className="text-xs font-extrabold text-slate-100 font-mono truncate">
                      {up?.current ? (app.kind === "release" ? `v${up.current}` : up.current) : app.health.version ? `v${app.health.version}` : "—"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{t("serverMonitor.apps.latest")}</p>
                    <p className={`text-xs font-extrabold truncate ${av ? "text-sky-400" : "text-slate-100"} ${av?.version ? "font-mono" : ""}`}>
                      {av ? (av.version ? `v${av.version}` : av.title) : up ? t("serverMonitor.apps.upToDate") : "—"}
                    </p>
                  </div>
                </div>

                {av && av.commits.length > 0 && (
                  <ul className="space-y-0.5">
                    {av.commits.slice(0, 4).map(c => (
                      <li key={c.short} className="text-[10px] text-slate-400 truncate">
                        <span className="font-mono text-slate-500">{c.short}</span> {c.subject}
                      </li>
                    ))}
                    {av.commits.length > 4 && <li className="text-[10px] text-slate-500">{t("serverMonitor.apps.moreCommits", { n: av.commits.length - 4 })}</li>}
                  </ul>
                )}
                {av?.url && (
                  <a href={av.url} target="_blank" rel="noreferrer noopener" className="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-1">
                    {t("serverMonitor.apps.releaseNotes")} <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                {app.control !== "ok" && app.controlError && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {app.controlError}
                  </p>
                )}
                {up?.blockers.map(b => (
                  <p key={b} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {b}
                  </p>
                ))}
                {av && up?.warnings.map(w => (
                  <p key={w} className="text-[11px] text-amber-600 dark:text-amber-400">{w}</p>
                ))}
                {(up?.checkError || errors[app.id]) && <p className="text-[11px] text-rose-400">{errors[app.id] || up?.checkError}</p>}

                {run && run.status !== "running" && (
                  <div
                    role="status"
                    className={`rounded-xl border p-2.5 flex items-start gap-2 ${run.status === "failed" ? "bg-rose-500/10 border-rose-500/25" : "bg-emerald-500/10 border-emerald-500/25"}`}
                  >
                    {run.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    )}
                    <p className="text-[11px] text-slate-300 flex-1">
                      {run.message ||
                        t(run.status === "failed" ? "serverMonitor.apps.failed" : run.kind === "update" ? "serverMonitor.apps.updated" : "serverMonitor.apps.restarted", { name: app.name })}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRuns(r => { const n = { ...r }; delete n[app.id]; return n; })}
                      aria-label={t("serverMonitor.apps.close")}
                      className="p-1 bg-slate-950 neu-btn rounded-lg text-slate-500 hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {running && <p className="text-[11px] text-sky-400">{t(run.kind === "update" ? "serverMonitor.apps.updatingHint" : "serverMonitor.apps.restartingHint")}</p>}

                <div className="flex flex-wrap items-center gap-2">
                  {av && (
                    <button
                      type="button"
                      onClick={() => handleUpdate(app)}
                      disabled={!canUpdate}
                      className="bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl px-3 py-2 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      {av.version ? t("serverMonitor.apps.updateTo", { version: av.version }) : t("serverMonitor.apps.updateGit")}
                    </button>
                  )}
                  {app.control === "ok" && (
                    <button
                      type="button"
                      onClick={() => handleCheck(app)}
                      disabled={checking === app.id || running || !!up?.busy}
                      className="flex items-center gap-1 bg-slate-950 neu-btn hover:bg-slate-800 text-cyan-400 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${checking === app.id ? "animate-spin" : ""}`} />
                      {checking === app.id ? t("serverMonitor.apps.checking") : t("serverMonitor.apps.check")}
                    </button>
                  )}
                  {app.canRestart && (
                    <button
                      type="button"
                      onClick={() => handleRestart(app)}
                      disabled={running || updaterBusy || !!up?.busy}
                      className="flex items-center gap-1 bg-slate-950 neu-btn hover:bg-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      <RotateCw className="w-3.5 h-3.5" /> {t("serverMonitor.apps.restart")}
                    </button>
                  )}
                  {up?.log && (
                    <button
                      type="button"
                      onClick={() => setOpenLog(l => (l === app.id ? null : app.id))}
                      className="text-[10px] text-sky-400 hover:underline cursor-pointer ml-auto"
                    >
                      {openLog === app.id ? t("serverMonitor.apps.hideLog") : t("serverMonitor.apps.showLog")}
                    </button>
                  )}
                </div>
                {up?.checkedAt && (
                  <p className="text-[10px] text-slate-500">{t("serverMonitor.apps.checkedAt", { time: fmtDateTime(up.checkedAt) })}</p>
                )}
                {openLog === app.id && up?.log && (
                  <pre className="max-h-56 overflow-auto bg-slate-950/70 neu-pressed-sm rounded-xl p-2.5 font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all">
                    {up.log}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Container được trông chừng */}
      {data.watch.containers.length > 0 && (
        <div className="bg-slate-950/40 neu-pressed-sm rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {bad.length ? (
              <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {t("serverMonitor.apps.containersBad", { n: bad.length, total: data.watch.containers.length })}
              </span>
            ) : (
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" /> {t("serverMonitor.apps.containersOk", { total: data.watch.containers.length })}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAll(s => !s)}
              className="ml-auto text-[10px] text-sky-400 hover:underline cursor-pointer flex items-center gap-0.5"
            >
              {showAll ? t("serverMonitor.apps.hideContainers") : t("serverMonitor.apps.showContainers")}
              <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          </div>
          {data.watch.stale && <p className="text-[10px] text-amber-600 dark:text-amber-400">{t("serverMonitor.apps.watchStale")}</p>}
          {listed.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
              {listed.map(c => {
                const isBad = BAD_PROBLEMS.includes(c.problem);
                const dot = isBad ? "bg-rose-400" : c.problem === "stopped" ? "bg-amber-400" : c.health === "starting" ? "bg-amber-400" : "bg-emerald-400";
                return (
                  <li key={c.name} className="flex items-center gap-2 min-w-0 text-[11px]">
                    <span className={`size-1.5 rounded-full shrink-0 ${dot}`} />
                    <span className="font-mono text-slate-300 truncate">{c.name}</span>
                    <span className={`ml-auto shrink-0 text-[10px] ${isBad ? "text-rose-400 font-bold" : "text-slate-500"}`}>
                      {c.problem === "ok" && c.health === "starting" ? t("serverMonitor.apps.statusStarting") : problemText(c.problem)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.watch.heals.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
                <Wrench className="w-3 h-3" /> {t("serverMonitor.apps.healsTitle")}
              </p>
              {data.watch.heals.slice(0, 5).map(h => (
                <p key={`${h.at}-${h.container}`} className="text-[10px] text-slate-400 flex gap-2 min-w-0">
                  <span className="font-mono text-slate-500 shrink-0">{fmtDateTime(h.at)}</span>
                  <span className={`min-w-0 break-words ${h.ok ? "" : "text-rose-400"}`}>
                    {t(h.ok ? "serverMonitor.apps.healOk" : "serverMonitor.apps.healFailed", { name: h.container, problem: problemText(h.problem) })}
                  </span>
                </p>
              ))}
            </div>
          )}
          {data.watch.checkedAt && (
            <p className="text-[10px] text-slate-500">
              {t(data.watch.enabled ? "serverMonitor.apps.watchOn" : "serverMonitor.apps.watchOff", { time: fmtDateTime(data.watch.checkedAt) })}
            </p>
          )}
        </div>
      )}

      {ConfirmDialog}
    </Reveal>
  );
}
