/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Phía app của cơ chế cập nhật (Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật).
//
// App KHÔNG tự cập nhật được chính nó (đang chạy trong container). Việc kéo image
// mới / khởi động lại do container `family-organizer-updater` làm (deploy/updater.sh).
// Hai bên nói chuyện qua file trong data/update/:
//   request.env    app → updater   (id, action, target, backup, restore, script)
//   state.env      updater → app   (heartbeat, phase, result, message, current…)
//   log.txt        updater → app   (log lần chạy gần nhất)
//   staged/<v>/    updater.sh của bản sắp cài (app tải từ tag trên GitHub)
//   snapshots/     bản chụp family.db trước mỗi lần cập nhật (.db.gz) — updater
//                  dùng để tự khôi phục nếu bản mới khởi động lỗi
//   settings.json  lịch tự cập nhật + cache danh sách phiên bản (ngoài DB & backup)
//
// Định dạng key=value thay vì JSON để script sh không cần jq.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { pipeline } from "stream/promises";

const DATA_DIR = path.join(process.cwd(), "data");
const UPDATE_DIR = path.join(DATA_DIR, "update");
const SNAPSHOT_DIR = path.join(UPDATE_DIR, "snapshots");
const STAGED_DIR = path.join(UPDATE_DIR, "staged");
const REQ_FILE = path.join(UPDATE_DIR, "request.env");
const STATE_FILE = path.join(UPDATE_DIR, "state.env");
const LOG_FILE = path.join(UPDATE_DIR, "log.txt");
const SETTINGS_FILE = path.join(UPDATE_DIR, "settings.json");

export const GITHUB_REPO = process.env.GITHUB_REPO || "happysmartlight/Family-Organizer";
const MAX_SNAPSHOTS = 5;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const SEMVER = /^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/;

// Import muộn các module đụng tới DB (sqlite/telegram): module này còn được test
// riêng, không nên mở family.db chỉ vì được import.
async function notify(text: string): Promise<void> {
  try {
    const { notifyTelegram } = await import("./telegramBackup.js");
    await notifyTelegram(text);
  } catch {
    /* thông báo phụ — bỏ qua nếu lỗi */
  }
}

// --- Bản đang chạy ---------------------------------------------------------
// CI truyền APP_VERSION (semver từ tag) + GIT_SHA + BUILD_TIME vào image.
// Bản build tay/dev không có → lấy version trong package.json.

function readPkgVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const envVersion = (process.env.APP_VERSION || "").trim().replace(/^v/, "");
export const BUILD = {
  version: SEMVER.test(envVersion) ? envVersion : readPkgVersion(),
  commit: process.env.GIT_SHA || "",
  buildTime: process.env.BUILD_TIME || ""
};

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.replace(/^v/, "").split(/[.-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// "YYYY-MM-DD" theo giờ địa phương của máy chủ (TZ trong compose).
const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// --- Cấu hình + cache (data/update/settings.json) --------------------------

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  url: string;
}

export type UpdateReason = "manual" | "auto" | "rollback";

interface UpdateSettings {
  autoUpdate: boolean;
  autoUpdateHour: number;
  lastCheckAt?: number;
  lastCheckError?: string;
  releases?: ReleaseInfo[];
  notifiedVersion?: string;
  lastAutoUpdateDate?: string;
  /** Lần cập nhật gần nhất app đã yêu cầu — để báo kết quả qua Telegram khi xong. */
  lastRequest?: { id: string; from: string; target: string; reason: UpdateReason; at: number; announced?: boolean };
  /** Immich chạy chung stack — chỉ kiểm tra bản mới + cập nhật khi admin bấm. */
  immich?: {
    latest?: ImmichRelease;
    lastCheckAt?: number;
    lastCheckError?: string;
    notifiedVersion?: string;
    lastRequest?: { id: string; from: string | null; at: number; announced?: boolean };
  };
}

const DEFAULT_SETTINGS: UpdateSettings = { autoUpdate: false, autoUpdateHour: 3 };
let settingsCache: UpdateSettings | null = null;

function getSettings(): UpdateSettings {
  if (settingsCache) return settingsCache;
  let parsed: Partial<UpdateSettings> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    /* lần đầu chạy */
  }
  settingsCache = { ...DEFAULT_SETTINGS, ...parsed };
  return settingsCache;
}

/** Sửa một phần rồi ghi nguyên khối (file tạm + rename — mất điện giữa chừng không hỏng file). */
function saveSettings(mutate: (s: UpdateSettings) => void): UpdateSettings {
  const next = structuredClone(getSettings());
  mutate(next);
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  settingsCache = next;
  return next;
}

export function setAutoUpdate(autoUpdate: boolean, autoUpdateHour: number): void {
  if (!Number.isInteger(autoUpdateHour) || autoUpdateHour < 0 || autoUpdateHour > 23) {
    throw new Error("Giờ tự cập nhật không hợp lệ (0–23).");
  }
  saveSettings(s => {
    s.autoUpdate = autoUpdate;
    s.autoUpdateHour = autoUpdateHour;
  });
}

// --- Trạng thái dịch vụ cập nhật -------------------------------------------

export interface UpdaterState {
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
  /** Hành động của lượt gần nhất: update | restart | immich. */
  action: string | null;
  /** Service Immich updater được phép cập nhật (rỗng = stack không có Immich / updater cũ). */
  immichServices: string[];
}

const IDLE_PHASES = ["idle", "done", "failed", "rolled_back", "unknown"];

export function readUpdaterState(): UpdaterState {
  let kv: Record<string, string> = {};
  try {
    kv = parseEnv(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* chưa có updater */
  }
  const hb = kv.heartbeat ? Number(kv.heartbeat) * 1000 : null;
  return {
    alive: hb != null && Date.now() - hb < 45_000,
    heartbeat: hb,
    phase: kv.phase || "unknown",
    requestId: kv.request_id || null,
    result: kv.result || null,
    message: kv.message || null,
    current: kv.current || null,
    previous: kv.previous || null,
    finishedAt: kv.finished_at ? Number(kv.finished_at) * 1000 : null,
    scriptVersion: kv.script_version || null,
    action: kv.action || null,
    immichServices: (kv.immich || "").split(" ").filter(Boolean)
  };
}

export function readUpdaterLog(maxLines = 200): string {
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

export function pendingRequest(): Record<string, string> | null {
  try {
    return parseEnv(fs.readFileSync(REQ_FILE, "utf8"));
  } catch {
    return null;
  }
}

function updaterBusy(state: UpdaterState): boolean {
  return !!pendingRequest() || !IDLE_PHASES.includes(state.phase);
}

const SAFE = /^[A-Za-z0-9._\-/]+$/;

interface UpdaterRequest {
  action: "update" | "restart" | "immich";
  target?: string;
  /** Bản chụp DB trước cập nhật — updater khôi phục nếu bản mới khởi động lỗi. */
  backup?: string;
  /** Khôi phục bản chụp này TRƯỚC khi chạy bản đích (quay về kèm dữ liệu). */
  restore?: string;
  script?: string;
}

function writeUpdaterRequest(req: UpdaterRequest): string {
  const state = readUpdaterState();
  if (!state.alive) throw new Error("Dịch vụ cập nhật (family-organizer-updater) không chạy. Xem hướng dẫn trong mục Phiên bản & Cập nhật.");
  if (updaterBusy(state)) throw new Error("Đang có một lượt cập nhật chạy dở, vui lòng chờ.");
  const id = crypto.randomUUID();
  const lines = [`id=${id}`, `action=${req.action}`];
  for (const [k, v] of Object.entries({ target: req.target, backup: req.backup, restore: req.restore, script: req.script })) {
    if (!v) continue;
    if (!SAFE.test(v) || v.includes("..")) throw new Error(`Giá trị không hợp lệ cho ${k}`);
    lines.push(`${k}=${v}`);
  }
  const tmp = `${REQ_FILE}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`, { mode: 0o664 });
  fs.renameSync(tmp, REQ_FILE);
  return id;
}

// --- Bản mới trên GitHub Releases ------------------------------------------

export async function checkReleases(): Promise<ReleaseInfo[]> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "family-organizer" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(res.status === 404 ? "Chưa có bản phát hành nào trên GitHub" : `GitHub trả lỗi HTTP ${res.status}`);
    const data = (await res.json()) as { tag_name: string; name: string; body: string; published_at: string; prerelease: boolean; draft: boolean; html_url: string }[];
    const releases = data
      .filter(r => !r.draft && /^v?\d+\.\d+\.\d+/.test(r.tag_name))
      .map(r => ({
        version: r.tag_name.replace(/^v/, ""),
        name: r.name || r.tag_name,
        notes: r.body ?? "",
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        url: r.html_url
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
    saveSettings(s => {
      s.releases = releases;
      s.lastCheckAt = Date.now();
      s.lastCheckError = undefined;
    });
    return releases;
  } catch (err: any) {
    const message = err?.name === "TimeoutError" ? "GitHub không phản hồi (hết thời gian chờ)" : err?.message || "Không kiểm tra được bản mới";
    saveSettings(s => {
      s.lastCheckAt = Date.now();
      s.lastCheckError = message;
    });
    throw new Error(message);
  }
}

function latestRelease(): ReleaseInfo | null {
  return (getSettings().releases ?? []).filter(r => !r.prerelease)[0] ?? null;
}

export function updateAvailable(): ReleaseInfo | null {
  const latest = latestRelease();
  return latest && compareVersions(latest.version, BUILD.version) > 0 ? latest : null;
}

// --- Bản chụp DB trước cập nhật --------------------------------------------

export interface SnapshotInfo {
  name: string;
  createdAt: number;
  sizeKb: number;
  from: string | null;
  to: string | null;
}

export function listSnapshots(): SnapshotInfo[] {
  try {
    return fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith(".db.gz"))
      .map(name => {
        const st = fs.statSync(path.join(SNAPSHOT_DIR, name));
        const m = name.match(/^pre-update_v(.+?)_to_v(.+?)_/);
        return { name, createdAt: st.mtimeMs, sizeKb: Math.ceil(st.size / 1024), from: m?.[1] ?? null, to: m?.[2] ?? null };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function createSnapshot(from: string, to: string): Promise<string> {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `pre-update_v${from}_to_v${to}_${stamp}.db.gz`;
  const raw = path.join(SNAPSHOT_DIR, name.replace(/\.gz$/, ""));
  const { sqliteBackupTo } = await import("./sqlite.js");
  try {
    await sqliteBackupTo(raw);
    await pipeline(fs.createReadStream(raw), zlib.createGzip(), fs.createWriteStream(path.join(SNAPSHOT_DIR, name)));
  } finally {
    fs.rmSync(raw, { force: true });
  }
  for (const old of listSnapshots().slice(MAX_SNAPSHOTS)) {
    fs.rmSync(path.join(SNAPSHOT_DIR, old.name), { force: true });
  }
  return name;
}

/**
 * Tải updater.sh của bản đích về data/update/staged/<v>/ — updater tự thay script
 * của mình sau khi cập nhật xong. Không tải được (mất mạng…) → giữ script hiện có.
 */
async function stageUpdaterScript(version: string): Promise<string | undefined> {
  try {
    fs.rmSync(STAGED_DIR, { recursive: true, force: true });
    const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/v${version}/deploy/updater.sh`, {
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    if (!text.startsWith("#!/bin/sh")) return undefined;
    const dir = path.join(STAGED_DIR, version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "updater.sh"), text);
    return `update/staged/${version}/updater.sh`;
  } catch {
    return undefined;
  }
}

// --- Luồng cập nhật ---------------------------------------------------------

/**
 * Bắt đầu cập nhật/quay về `target`.
 * - Luôn chụp DB trước; updater dùng bản này để tự quay về nếu bản mới khởi động lỗi.
 * - `restoreSnapshot`: (quay về bản cũ kèm dữ liệu) khôi phục bản chụp này trước khi chạy `target`.
 */
let starting = false;

export async function startUpdate(target: string, opts: { restoreSnapshot?: string | null; reason: UpdateReason }) {
  if (!SEMVER.test(target)) throw new Error("Phiên bản không hợp lệ.");
  if (target === BUILD.version) throw new Error(`Đang chạy v${target} rồi.`);
  const state = readUpdaterState();
  if (!state.alive) throw new Error("Dịch vụ cập nhật (family-organizer-updater) không chạy.");
  if (starting || updaterBusy(state)) throw new Error("Đang có một lượt cập nhật chạy dở, vui lòng chờ.");
  if (opts.restoreSnapshot && !listSnapshots().some(s => s.name === opts.restoreSnapshot)) {
    throw new Error("Không tìm thấy bản sao lưu để khôi phục.");
  }

  // Chụp DB + tải script mất vài giây — khóa để hai lần bấm liền nhau không chạy song song.
  starting = true;
  let snapshot: string;
  let id: string;
  try {
    snapshot = await createSnapshot(BUILD.version, target);
    const script = await stageUpdaterScript(target);
    id = writeUpdaterRequest({
      action: "update",
      target,
      backup: `update/snapshots/${snapshot}`,
      restore: opts.restoreSnapshot ? `update/snapshots/${opts.restoreSnapshot}` : undefined,
      script
    });
  } finally {
    starting = false;
  }
  saveSettings(s => {
    s.lastRequest = { id, from: BUILD.version, target, reason: opts.reason, at: Date.now() };
  });

  const verb = compareVersions(target, BUILD.version) < 0 ? "Quay về" : "Cập nhật lên";
  const how = opts.reason === "auto" ? "tự động ban đêm" : "thủ công";
  void notify(`🔄 Family Organizer: ${verb} v${target} (${how}).\nĐang chạy v${BUILD.version}, đã sao lưu dữ liệu trước khi cập nhật.`);
  return { requestId: id, snapshot };
}

export function requestRestart(): string {
  return writeUpdaterRequest({ action: "restart" });
}

export function getUpdateOverview() {
  const s = getSettings();
  return {
    current: BUILD,
    updater: readUpdaterState(),
    pending: pendingRequest(),
    log: readUpdaterLog(),
    available: updateAvailable(),
    releases: (s.releases ?? []).map(r => ({
      ...r,
      isCurrent: r.version === BUILD.version,
      isNewer: compareVersions(r.version, BUILD.version) > 0
    })),
    lastCheckAt: s.lastCheckAt ?? null,
    lastCheckError: s.lastCheckError ?? null,
    autoUpdate: s.autoUpdate,
    autoUpdateHour: s.autoUpdateHour,
    repo: GITHUB_REPO,
    snapshots: listSnapshots(),
    lastRequest: s.lastRequest ?? null
  };
}

// --- Vòng định kỳ: kiểm tra bản mới, báo Telegram, tự cập nhật ban đêm ------

/** Báo kết quả lần cập nhật gần nhất (chạy ở bản mới — hoặc bản cũ nếu đã quay về). */
function announceLastResult(): void {
  const r = getSettings().lastRequest;
  if (!r || r.announced) return;
  const st = readUpdaterState();
  if (st.requestId !== r.id || !st.finishedAt || !st.result) {
    if (Date.now() - r.at > 30 * 60 * 1000) {
      saveSettings(s => {
        if (s.lastRequest) s.lastRequest.announced = true;
      });
    }
    return;
  }
  saveSettings(s => {
    if (s.lastRequest) s.lastRequest.announced = true;
  });
  const msg =
    st.result === "ok"
      ? `✅ Family Organizer đã lên v${r.target}.`
      : st.result === "rolled_back"
        ? `⚠️ Bản v${r.target} khởi động lỗi — đã tự quay về v${st.previous || r.from} và khôi phục dữ liệu trước lúc cập nhật.`
        : `❌ Cập nhật v${r.target} thất bại: ${st.message || "lỗi không rõ"}`;
  void notify(msg);
}

let ticking = false;

export async function runUpdateTick(now = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    announceLastResult();
    await announceImmichResult();
    await appTick(now);
    await immichTick(now);
  } catch (e: any) {
    console.error("Lỗi vòng kiểm tra cập nhật:", e?.message || e);
  } finally {
    ticking = false;
  }
}

async function appTick(now: Date): Promise<void> {
  const s = getSettings();
  if (!s.lastCheckAt || now.getTime() - s.lastCheckAt >= CHECK_EVERY_MS) {
    await checkReleases().catch(() => {});
  }

  const avail = updateAvailable();
  if (!avail) return;
  const cfg = getSettings();
  if (cfg.notifiedVersion !== avail.version) {
    saveSettings(c => {
      c.notifiedVersion = avail.version;
    });
    const when = cfg.autoUpdate ? `App sẽ tự cập nhật lúc ${cfg.autoUpdateHour}:00.` : "Vào Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật để xem thay đổi và cài.";
    void notify(`✨ Family Organizer có bản mới v${avail.version} (đang chạy v${BUILD.version}).\n${when}`);
  }

  const today = localDateKey(now);
  if (cfg.autoUpdate && now.getHours() === cfg.autoUpdateHour && cfg.lastAutoUpdateDate !== today && readUpdaterState().alive) {
    saveSettings(c => {
      c.lastAutoUpdateDate = today;
    });
    try {
      await startUpdate(avail.version, { reason: "auto" });
    } catch (e: any) {
      void notify(`⏸ Không tự cập nhật được v${avail.version} đêm nay: ${e?.message || "lỗi không rõ"}`);
    }
  }
}

// --- Immich (chạy chung stack liu-homelab) ------------------------------------
// Updater tự dò service Immich có trong compose (state.env: immich=...) và chỉ chạy
// `docker compose pull` + `up -d` cho đúng các service đó. App chỉ gửi action=immich.
// KHÔNG tự cập nhật Immich: bản lớn hay có breaking changes, admin đọc ghi chú rồi bấm.

const IMMICH_URL = (process.env.IMMICH_URL || "http://immich-server:2283").replace(/\/+$/, "");
const IMMICH_REPO = "immich-app/immich";

export interface ImmichRelease {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  /** Ghi chú phát hành nhắc tới breaking changes → cảnh báo admin đọc kỹ. */
  breaking: boolean;
}

export type ImmichStatus = "ready" | "updater_down" | "updater_old" | "no_immich";

function immichStatus(st: UpdaterState): ImmichStatus {
  if (!st.alive) return "updater_down";
  if (Number(st.scriptVersion || 0) < 2) return "updater_old";
  return st.immichServices.length ? "ready" : "no_immich";
}

/** Phiên bản Immich đang chạy — endpoint công khai, gọi thẳng trong mạng docker của stack. */
async function immichRunningVersion(): Promise<{ version: string | null; error: string | null }> {
  try {
    const res = await fetch(`${IMMICH_URL}/api/server/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = (await res.json()) as { major: number; minor: number; patch: number };
    return { version: `${v.major}.${v.minor}.${v.patch}`, error: null };
  } catch (e: any) {
    return {
      version: null,
      error: e?.name === "TimeoutError" ? "Immich không phản hồi" : `Không đọc được phiên bản Immich (${e?.message || "lỗi"})`
    };
  }
}

export async function checkImmichRelease(): Promise<ImmichRelease> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "family-organizer" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${IMMICH_REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(`GitHub trả lỗi HTTP ${res.status}`);
    const r = (await res.json()) as { tag_name: string; name: string; html_url: string; published_at: string; body: string };
    const latest: ImmichRelease = {
      version: String(r.tag_name || "").replace(/^v/, ""),
      name: r.name || r.tag_name,
      url: r.html_url,
      publishedAt: r.published_at,
      breaking: /breaking[\s-]*change/i.test(r.body || "")
    };
    saveSettings(s => {
      s.immich = { ...s.immich, latest, lastCheckAt: Date.now(), lastCheckError: undefined };
    });
    return latest;
  } catch (err: any) {
    const message =
      err?.name === "TimeoutError" ? "GitHub không phản hồi (hết thời gian chờ)" : err?.message || "Không kiểm tra được bản Immich mới";
    saveSettings(s => {
      s.immich = { ...s.immich, lastCheckAt: Date.now(), lastCheckError: message };
    });
    throw new Error(message);
  }
}

export async function getImmichOverview() {
  const st = readUpdaterState();
  const im = getSettings().immich ?? {};
  const running = await immichRunningVersion();
  const latest = im.latest ?? null;
  return {
    status: immichStatus(st),
    services: st.immichServices,
    running,
    latest,
    updateAvailable: !!(latest && running.version && compareVersions(latest.version, running.version) > 0),
    lastCheckAt: im.lastCheckAt ?? null,
    lastCheckError: im.lastCheckError ?? null,
    busy: updaterBusy(st),
    updater: {
      phase: st.phase,
      requestId: st.requestId,
      action: st.action,
      result: st.result,
      message: st.message,
      finishedAt: st.finishedAt
    },
    lastRequest: im.lastRequest ?? null,
    log: st.action === "immich" ? readUpdaterLog() : ""
  };
}

export async function startImmichUpdate(): Promise<{ requestId: string; from: string | null }> {
  const status = immichStatus(readUpdaterState());
  if (status === "updater_down") throw new Error("Dịch vụ cập nhật (family-organizer-updater) không chạy.");
  if (status === "updater_old") {
    throw new Error(
      "Dịch vụ cập nhật đang là bản cũ, chưa biết cập nhật Immich. Cập nhật Family Organizer một lần (hoặc chạy lại setup.sh) để nâng cấp."
    );
  }
  if (status === "no_immich") throw new Error("Stack này không có Immich.");
  const { version: from } = await immichRunningVersion();
  const id = writeUpdaterRequest({ action: "immich" });
  saveSettings(s => {
    s.immich = { ...s.immich, lastRequest: { id, from, at: Date.now() } };
  });
  void notify(`🔄 Đang cập nhật Immich${from ? ` (đang chạy v${from})` : ""}: kéo bản mới rồi khởi động lại.`);
  return { requestId: id, from };
}

async function announceImmichResult(): Promise<void> {
  const r = getSettings().immich?.lastRequest;
  if (!r || r.announced) return;
  const markAnnounced = () =>
    saveSettings(s => {
      if (s.immich?.lastRequest) s.immich.lastRequest.announced = true;
    });
  const st = readUpdaterState();
  if (st.requestId !== r.id || !st.finishedAt || !st.result) {
    if (Date.now() - r.at > 60 * 60 * 1000) markAnnounced();
    return;
  }
  markAnnounced();
  if (st.result !== "ok") {
    void notify(`❌ Cập nhật Immich thất bại: ${st.message || "lỗi không rõ"}`);
    return;
  }
  const { version } = await immichRunningVersion();
  const same = !!version && version === r.from;
  void notify(
    `✅ Immich đã cập nhật${version ? ` — đang chạy v${version}` : ""}.` +
      (same ? " (Vẫn là bản cũ: image Immich có thể chưa ra bản mới, hoặc IMMICH_VERSION trong .env đang ghim bản cố định.)" : "")
  );
}

async function immichTick(now: Date): Promise<void> {
  if (immichStatus(readUpdaterState()) !== "ready") return;
  const im = getSettings().immich ?? {};
  if (!im.lastCheckAt || now.getTime() - im.lastCheckAt >= CHECK_EVERY_MS) {
    await checkImmichRelease().catch(() => {});
  }
  const latest = getSettings().immich?.latest;
  if (!latest || getSettings().immich?.notifiedVersion === latest.version) return;
  const { version } = await immichRunningVersion();
  if (!version || compareVersions(latest.version, version) <= 0) return;
  saveSettings(s => {
    s.immich = { ...s.immich, notifiedVersion: latest.version };
  });
  void notify(
    `📸 Immich có bản mới v${latest.version} (đang chạy v${version}).` +
      (latest.breaking ? "\n⚠️ Ghi chú phát hành có BREAKING CHANGES — đọc kỹ trước khi cập nhật." : "") +
      `\nĐọc ghi chú: ${latest.url}\nCập nhật trong Family Organizer → Quản lý Server.`
  );
}
