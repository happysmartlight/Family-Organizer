/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Quản lý Server → "Ứng dụng trong nhà": Family Organizer làm trung tâm điều khiển
// cho các app tự host chạy ở stack riêng trên cùng máy (Car Rental, KidTube).
//   - Cập nhật: gọi API cập nhật SẴN CÓ của từng app bằng khóa chung HUB_TOKEN
//     (server ↔ server). App đó tự lo sao lưu + tự quay về y như khi bấm trong chính nó.
//   - Khởi động lại: nhờ family-organizer-updater (action app_restart) — chạy được cả
//     khi app treo, không phụ thuộc API của app.
//   - Trạng thái container: updater ghi containers.txt (server/updater.ts).
// Cấu hình qua env (compose của liu-homelab): HUB_TOKEN, CAR_RENTAL_URL / CAR_RENTAL_PUBLIC_URL,
// KIDTUBE_URL / KIDTUBE_PUBLIC_URL. App nào không đặt URL thì không hiện.

import { readContainers, readHealEvents, readUpdaterState, requestAppRestart, type ContainerStatus } from "./updater.js";

type AppKind = "release" | "git";

interface AppDef {
  id: string;
  name: string;
  /** release = phát hành theo phiên bản (GitHub Releases); git = cập nhật theo commit mới. */
  kind: AppKind;
  baseUrl: string;
  publicUrl: string;
  container: string;
}

export function managedApps(): AppDef[] {
  const list: AppDef[] = [];
  const add = (id: string, name: string, kind: AppKind, urlVar: string, publicVar: string) => {
    const baseUrl = (process.env[urlVar] || "").trim().replace(/\/+$/, "");
    if (baseUrl) list.push({ id, name, kind, baseUrl, publicUrl: (process.env[publicVar] || "").trim(), container: id });
  };
  add("car-rental", "Car Rental", "release", "CAR_RENTAL_URL", "CAR_RENTAL_PUBLIC_URL");
  add("kidtube", "KidTube", "git", "KIDTUBE_URL", "KIDTUBE_PUBLIC_URL");
  return list;
}

function findApp(id: string): AppDef {
  const app = managedApps().find(a => a.id === id);
  if (!app) throw new Error("Không có app này.");
  return app;
}

// --- Gọi API của app -----------------------------------------------------------

type ControlState = "ok" | "no_token" | "unauthorized" | "unreachable" | "error";

class AppApiError extends Error {
  constructor(message: string, readonly state: ControlState) {
    super(message);
  }
}

const hubToken = () => (process.env.HUB_TOKEN || "").trim();

async function call<T>(app: AppDef, pathname: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth !== false;
  if (auth && !hubToken()) throw new AppApiError("Chưa đặt HUB_TOKEN cho Family Organizer (chạy lại setup.sh của liu-homelab).", "no_token");
  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = `Bearer ${hubToken()}`;
  // Chỉ gắn content-type khi có body: Fastify trả 400 cho JSON rỗng.
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(app.baseUrl + pathname, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(8000)
    });
  } catch (e: any) {
    throw new AppApiError(e?.name === "TimeoutError" ? `${app.name} không phản hồi.` : `Không kết nối được ${app.name}.`, "unreachable");
  }
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401 || res.status === 403) {
    throw new AppApiError(
      `${app.name} chưa nhận khóa điều khiển từ Family Organizer — cập nhật ${app.name} lên bản mới (trong chính app đó) và đặt HUB_TOKEN trong .env của nó.`,
      "unauthorized"
    );
  }
  if (!res.ok) throw new AppApiError(body?.error || `${app.name} trả lỗi HTTP ${res.status}.`, "error");
  return body as T;
}

// --- Thông tin cập nhật, quy về một dạng chung cho giao diện --------------------

export interface AppUpdateInfo {
  /** Phiên bản (release) hoặc commit ngắn (git) đang chạy. */
  current: string | null;
  available: {
    version: string | null;
    title: string;
    notes: string;
    url: string | null;
    commits: { short: string; subject: string }[];
  } | null;
  checkedAt: number | null;
  checkError: string | null;
  updaterOnline: boolean;
  /** Updater riêng của app đang làm việc (cập nhật / kiểm tra). */
  busy: boolean;
  phase: string;
  last: { ok: boolean; message: string | null; at: number | null } | null;
  /** Không cập nhật được vì… */
  blockers: string[];
  /** Cập nhật được nhưng nên biết… */
  warnings: string[];
  log: string;
}

const RELEASE_IDLE = ["idle", "done", "failed", "rolled_back", "unknown"];

interface ReleaseOverview {
  current: { version: string };
  updater: { alive: boolean; phase: string; result: string | null; message: string | null; finishedAt: number | null };
  pending: Record<string, string> | null;
  log: string;
  available: { version: string; name: string; notes: string; url: string } | null;
  lastCheckAt: number | null;
  lastCheckError: string | null;
}

function fromRelease(o: ReleaseOverview): AppUpdateInfo {
  const u = o.updater;
  return {
    current: o.current?.version ?? null,
    available: o.available
      ? { version: o.available.version, title: o.available.name || `v${o.available.version}`, notes: o.available.notes || "", url: o.available.url || null, commits: [] }
      : null,
    checkedAt: o.lastCheckAt ?? null,
    checkError: o.lastCheckError ?? null,
    updaterOnline: !!u?.alive,
    busy: !!o.pending || !RELEASE_IDLE.includes(u?.phase || "unknown"),
    phase: u?.phase || "unknown",
    last: u?.finishedAt ? { ok: u.result === "ok", message: u.message, at: u.finishedAt } : null,
    blockers: u?.alive ? [] : ["Dịch vụ cập nhật riêng của app không chạy."],
    warnings: [],
    log: o.log || ""
  };
}

interface GitOverview {
  running: { version: string; commitShort: string | null };
  updater: { installed: boolean; online: boolean; phase: string; pendingRequest: boolean; repoOk: boolean; repoError: string | null };
  repo: { headShort: string; dirty: boolean; behind: number; pending: { short: string; subject: string }[]; checkedAt: string; fetchError: string | null } | null;
  deployedCommit: string | null;
  lastRun: { action: string; finishedAt: string; ok: boolean; error: string | null } | null;
  log: string | null;
  warnings: { activeKidSessions: number; downloadRunning: boolean };
}

function fromGit(o: GitOverview): AppUpdateInfo {
  const u = o.updater;
  const repo = o.repo;
  const blockers: string[] = [];
  if (!u?.online) blockers.push(u?.installed ? "Dịch vụ cập nhật riêng của app không chạy." : "App chưa bật dịch vụ cập nhật riêng (kidtube-updater).");
  else if (!u.repoOk) blockers.push(u.repoError || "Dịch vụ cập nhật chưa thấy thư mục cài đặt.");
  else if (repo?.dirty) blockers.push("Thư mục cài đặt trên Pi có thay đổi chưa commit — xử lý bằng tay trước.");
  const warnings: string[] = [];
  if (o.warnings?.activeKidSessions) warnings.push(`Có ${o.warnings.activeKidSessions} bé đang xem — cập nhật sẽ cắt ngang video.`);
  if (o.warnings?.downloadRunning) warnings.push("Đang tải video về — cập nhật sẽ làm gián đoạn.");
  const run = o.lastRun?.action === "update" ? o.lastRun : null;
  return {
    current: o.running?.commitShort || o.deployedCommit?.slice(0, 7) || repo?.headShort || null,
    available:
      repo && repo.behind > 0
        ? { version: null, title: `${repo.behind} thay đổi mới`, notes: "", url: null, commits: repo.pending ?? [] }
        : null,
    checkedAt: repo?.checkedAt ? Date.parse(repo.checkedAt) || null : null,
    checkError: repo?.fetchError ?? null,
    updaterOnline: !!u?.online,
    busy: !!u?.pendingRequest || u?.phase === "updating" || u?.phase === "checking",
    phase: u?.phase || "idle",
    last: run ? { ok: run.ok, message: run.error, at: Date.parse(run.finishedAt) || null } : null,
    blockers,
    warnings,
    log: o.log || ""
  };
}

const UPDATE_PATH: Record<AppKind, string> = { release: "/api/system/update", git: "/api/admin/update" };

async function fetchUpdateInfo(app: AppDef): Promise<AppUpdateInfo> {
  const raw = await call<any>(app, UPDATE_PATH[app.kind]);
  return app.kind === "release" ? fromRelease(raw) : fromGit(raw);
}

// --- Tổng quan + hành động -----------------------------------------------------

export interface ManagedAppOverview {
  id: string;
  name: string;
  kind: AppKind;
  publicUrl: string;
  container: ContainerStatus | null;
  health: { ok: boolean; version: string | null; error: string | null };
  control: ControlState;
  controlError: string | null;
  update: AppUpdateInfo | null;
  /** family-organizer-updater quản lý app này → nút Khởi động lại dùng được. */
  canRestart: boolean;
}

async function appOverview(app: AppDef, containers: ContainerStatus[], updaterApps: string[]): Promise<ManagedAppOverview> {
  const [health, update] = await Promise.all([
    call<{ ok?: boolean; version?: string }>(app, "/api/health", { auth: false })
      .then(h => ({ ok: h.ok === true, version: h.version ?? null, error: null }))
      .catch((e: Error) => ({ ok: false, version: null, error: e.message })),
    fetchUpdateInfo(app)
      .then(u => ({ update: u, control: "ok" as ControlState, controlError: null }))
      .catch((e: any) => ({ update: null, control: (e instanceof AppApiError ? e.state : "error") as ControlState, controlError: e?.message || "Lỗi không rõ" }))
  ]);
  return {
    id: app.id,
    name: app.name,
    kind: app.kind,
    publicUrl: app.publicUrl,
    container: containers.find(c => c.name === app.container) ?? null,
    health,
    ...update,
    canRestart: updaterApps.includes(app.id)
  };
}

export async function getAppsOverview() {
  const st = readUpdaterState();
  const watch = readContainers();
  const apps = await Promise.all(managedApps().map(a => appOverview(a, watch.containers, st.apps)));
  return {
    apps,
    watch: { ...watch, enabled: st.alive && Number(st.scriptVersion || 0) >= 3 && (st.watchEvery ?? 0) > 0, heals: readHealEvents(10) },
    updater: {
      alive: st.alive,
      phase: st.phase,
      action: st.action,
      requestId: st.requestId,
      result: st.result,
      message: st.message,
      finishedAt: st.finishedAt
    }
  };
}

export async function checkAppUpdate(id: string): Promise<AppUpdateInfo> {
  const app = findApp(id);
  await call(app, `${UPDATE_PATH[app.kind]}/check`, { method: "POST" });
  return fetchUpdateInfo(app);
}

/** release: cài đúng `version` admin đã xem (tránh cài nhầm bản vừa ra); git: kéo commit mới nhất. */
export async function startAppUpdate(id: string, version?: string | null): Promise<{ target: string | null }> {
  const app = findApp(id);
  const info = await fetchUpdateInfo(app);
  if (info.blockers.length) throw new Error(info.blockers[0]);
  if (info.busy) throw new Error(`${app.name} đang cập nhật dở, chờ xong rồi thử lại.`);
  if (app.kind === "release") {
    const target = version || info.available?.version;
    if (!target || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(target)) throw new Error(`${app.name} không có bản mới để cài.`);
    await call(app, "/api/system/update/apply", { method: "POST", body: { version: target } });
    return { target };
  }
  if (!info.available) throw new Error(`${app.name} đang ở bản mới nhất.`);
  await call(app, "/api/admin/update/run", { method: "POST" });
  return { target: null };
}

export function restartApp(id: string): string {
  const app = findApp(id);
  return requestAppRestart(app.id);
}
