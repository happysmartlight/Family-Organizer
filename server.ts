/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import os from "os";
import fsp from "fs/promises";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { FamilyDB, verifyPassword, getSessionSecret, getAppSettings, setAppSetting } from "./server/db.js";
import { sqliteAppendServerMetric, sqliteGetServerMetrics } from "./server/sqlite.js";
import { UserRole, isLimitedViewer, DishSlot, MealIngredient, DOCUMENT_TYPE_LABELS } from "./src/types.js";
import { buildPlanFromLibrary, dedupeAndAnnotateGroceries } from "./src/utils/mealPlan.js";
import { normalizeSearchText, matchesQuery, excerptAround } from "./src/utils/searchText.js";
import { saveDataUrlToFile, UPLOADS_DIR } from "./server/media.js";
import { streamFullBackup, fullBackupFilename, importFullBackup } from "./server/fullBackup.js";
import { telegramBackupStatus, sendBackupToTelegram, runTelegramBackupTick } from "./server/telegramBackup.js";
import { sendWeeklyDigest, runWeeklyDigestTick } from "./server/weeklyDigest.js";
import { icsFeedToken, isValidIcsToken, buildIcsFeed } from "./server/icsFeed.js";
import { getVapidPublicKey, isPushConfigured, sendTestPush } from "./server/push.js";

// Accepted permission roles for write validation
const VALID_ROLES = new Set<string>([UserRole.ADMIN, UserRole.MEMBER, UserRole.CHILD, UserRole.GUEST]);
const MAX_AVATAR_IMAGE_CHARS = 2_500_000;

// Images are stored either as "/uploads/..." file references (new) or, for older
// records, inline base64 "data:image/..." URLs. Both are accepted on write.
function isStoredImageRef(value: string): boolean {
  return value.startsWith("/uploads/") || value.startsWith("data:image/");
}

function validateAvatarImagePayload(avatarImage: unknown) {
  if (avatarImage === undefined || avatarImage === "") return;
  if (typeof avatarImage !== "string" || !isStoredImageRef(avatarImage)) {
    throw new Error("Ảnh đại diện không hợp lệ.");
  }
  // Length cap only matters for inline base64; file refs are short.
  if (avatarImage.startsWith("data:image/") && avatarImage.length > MAX_AVATAR_IMAGE_CHARS) {
    throw new Error("Ảnh đại diện sau khi tối ưu vẫn quá lớn. Vui lòng chọn ảnh khác.");
  }
}

const MAX_ASSET_PHOTOS = 8;
const MAX_ASSET_PHOTO_CHARS = 2_500_000;

function validateImageRef(value: unknown, label: string, maxChars: number) {
  if (typeof value !== "string" || !isStoredImageRef(value)) {
    throw new Error(`${label} không hợp lệ.`);
  }
  if (value.startsWith("data:image/") && value.length > maxChars) {
    throw new Error(`${label} quá lớn. Vui lòng để app tối ưu ảnh trước khi lưu.`);
  }
}

function validateAssetPhotosPayload(photos: unknown) {
  if (photos === undefined) return;
  if (!Array.isArray(photos)) throw new Error("Danh sách ảnh tài sản không hợp lệ.");
  if (photos.length > MAX_ASSET_PHOTOS) {
    throw new Error(`Mỗi tài sản chỉ nên lưu tối đa ${MAX_ASSET_PHOTOS} ảnh.`);
  }

  photos.forEach((photo, idx) => {
    if (!photo || typeof photo !== "object") throw new Error(`Ảnh tài sản #${idx + 1} không hợp lệ.`);
    const item = photo as any;
    validateImageRef(item.thumbnailDataUrl, `Ảnh thu nhỏ #${idx + 1}`, 500_000);
    validateImageRef(item.fullDataUrl, `Ảnh xem lớn #${idx + 1}`, MAX_ASSET_PHOTO_CHARS);
  });
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --- VERSION / UPDATE CONFIG ---
// APP_VERSION/GIT_SHA/BUILD_TIME are baked into the image at build time (see Dockerfile + CI).
const APP_VERSION = process.env.APP_VERSION || "dev";
const GIT_SHA = process.env.GIT_SHA || "";
const BUILD_TIME = process.env.BUILD_TIME || "";
// GitHub repo used to check whether a newer commit exists on the default branch.
const GITHUB_REPO = process.env.GITHUB_REPO || "happysmartlight/Family-Organizer";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
// Optional Watchtower HTTP API for one-click in-app updates.
const WATCHTOWER_URL = process.env.WATCHTOWER_URL || "";
const WATCHTOWER_TOKEN = process.env.WATCHTOWER_HTTP_API_TOKEN || "";

// --- GEMINI API KEY ---
// Admin can set a key from the UI (stored in app_settings.json); falls back to env.
function getGeminiKey(): string {
  const fromDb = (getAppSettings().geminiApiKey || "").trim();
  return fromDb || (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
}
function geminiKeySource(): "app" | "env" | "none" {
  if ((getAppSettings().geminiApiKey || "").trim()) return "app";
  if ((process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim()) return "env";
  return "none";
}
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
function aiStatus() {
  const key = getGeminiKey();
  return { configured: Boolean(key), source: geminiKeySource(), masked: maskKey(key) };
}
// Lightweight validation: make a tiny call so a bad key fails fast at save time.
async function testGeminiKey(key: string): Promise<void> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: key });
  await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "ping",
    config: { responseMimeType: "text/plain" }
  } as any);
}

// Gemini thường trả 503 "model overloaded" / 429 khi quá tải — lỗi tạm thời.
function isGeminiOverloaded(err: any): boolean {
  const msg = String(err?.message || err || "");
  return /\b(503|429)\b|overloaded|unavailable|rate.?limit|quota|try again/i.test(msg);
}
function geminiErrorMessage(err: any): string {
  if (isGeminiOverloaded(err)) {
    return "Gemini đang quá tải (503). Đã thử lại nhưng chưa được — bạn chờ một lát rồi bấm lại nhé.";
  }
  return err?.message || "AI đang gặp lỗi, vui lòng thử lại.";
}
// Gọi Gemini có tự thử lại khi bị quá tải (503/429) với backoff nhẹ.
async function geminiGenerate(ai: any, params: any, retries = 2): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      if (!isGeminiOverloaded(err) || attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, 2s
    }
  }
  throw lastErr;
}

// Body parser - supports rich receipt images in finances
app.use(express.json({ limit: "15mb" }));

// --- SESSION TOKEN SIGNING ---
// Tokens are stateless: "userId.HMAC(userId)". They cannot be forged without the
// per-install secret, so a guessable userId alone is no longer a valid session.
const SESSION_SECRET = getSessionSecret();

function signToken(userId: string): string {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

function verifyToken(token: string): string | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  const userId = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return userId;
}

// --- SIMPLE LOGIN RATE LIMITING (in-memory, per IP) ---
const loginAttempts = new Map<string, { count: number; first: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 8;

function isRateLimited(ip: string): boolean {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > RATE_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return rec.count >= RATE_MAX;
}

function recordLoginFailure(ip: string): void {
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() - rec.first > RATE_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

// Server-Sent Events client pool for real-time synchronization
let sseClients: Response[] = [];

// Realtime sync broadcast helper
function broadcastSyncEvent(eventType: string, extraData: any = {}) {
  const payload = JSON.stringify({ type: eventType, timestamp: new Date().toISOString(), ...extraData });
  sseClients.forEach(client => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (e) {
      console.error("SSE broadcast write failed:", e);
    }
  });
}

// Authentication middleware to extract current user session
interface AuthRequest extends Request {
  userSession?: {
    userId: string;
    username: string;
    fullName: string;
    role: UserRole;
  };
}

const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.split(" ")[1];
  const userId = verifyToken(token);
  if (!userId) {
    next();
    return;
  }

  const users = FamilyDB.getUsers();
  const matchedUser = users.find(u => u.id === userId);

  if (matchedUser && !matchedUser.isDeleted) {
    req.userSession = {
      userId: matchedUser.id,
      username: matchedUser.username,
      fullName: matchedUser.fullName,
      role: matchedUser.role
    };
  }
  next();
};

app.use(authMiddleware as any);

// --- CỜ BẢO TRÌ (chặn ghi trong lúc import backup toàn phần) ---
// Import có các bước await dài (giải nén media); ghi song song trong lúc đó sẽ
// bị snapshot restore nuốt mất nên chặn hẳn với 503 cho tới khi import xong.
let maintenanceMode = false;
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (maintenanceMode && req.method !== "GET") {
    res.status(503).json({ error: "Server đang khôi phục dữ liệu từ backup — vui lòng thử lại sau ít giây." });
    return;
  }
  next();
});

// --- OPTIMISTIC LOCKING (chống 2 người cùng sửa một bản ghi đè nhau) ---
// Form sửa gửi kèm baseUpdatedAt = updatedAt của bản đang mở trong form. Server
// so với bản hiện tại: lệch nghĩa là có người khác đã lưu trong lúc form còn mở
// → trả 409 để client hiện lỗi thay vì lặng lẽ ghi đè. Thao tác nhanh 1 field
// (toggle trạng thái...) KHÔNG gửi baseUpdatedAt nên không bị chặn — server đã
// merge field với bản mới nhất. Field chỉ dùng để so, luôn xóa khỏi payload
// trước khi lưu để không dính vào bản ghi.
const hasEditConflict = (existing: { updatedAt?: string } | undefined, body: any): boolean => {
  const base = body?.baseUpdatedAt;
  if (body && "baseUpdatedAt" in body) delete body.baseUpdatedAt;
  return typeof base === "string" && base !== "" && !!existing?.updatedAt && existing.updatedAt !== base;
};
const CONFLICT_MSG = "Bản ghi này vừa được người khác lưu trong lúc bạn đang mở form. Đóng form để xem nội dung mới nhất rồi sửa tiếp nhé.";

// Serve uploaded media (avatars/assets/receipts) as static files. Filenames are
// random/unguessable; the app runs on a private LAN/Tailscale network. Mounted
// before the SPA catch-all so image URLs resolve in both dev and production.
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d", immutable: true, fallthrough: false }));

// Enforce authentication on APIs
const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.userSession) {
    res.status(401).json({ error: "Vui lòng đăng nhập để thực hiện tác vụ này!" });
    return;
  }
  next();
};

// Enforce specific role level
const requireRole = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userSession) {
      res.status(401).json({ error: "Bạn chưa đăng nhập!" });
      return;
    }
    if (!roles.includes(req.userSession.role)) {
      res.status(403).json({ error: `Tài khoản của bạn (${req.userSession.role}) không được phép thực hiện thao tác này!` });
      return;
    }
    next();
  };
};

const canViewSavingsGoal = (goal: { isShared: boolean; creatorId: string }, session: AuthRequest["userSession"]) => {
  if (!session) return false;
  return goal.isShared || goal.creatorId === session.userId;
};

const canManageSavingsGoal = (goal: { isShared: boolean; creatorId: string }, session: AuthRequest["userSession"]) => {
  if (!session) return false;
  return goal.creatorId === session.userId || (goal.isShared && session.role === UserRole.ADMIN);
};

const canViewDocument = (
  doc: { isShared: boolean; creatorId: string; ownerId?: string },
  session: AuthRequest["userSession"]
) => {
  if (!session) return false;
  return doc.isShared || doc.creatorId === session.userId || doc.ownerId === session.userId;
};

const canManageDocument = (
  doc: { isShared: boolean; creatorId: string; ownerId?: string },
  session: AuthRequest["userSession"]
) => {
  if (!session) return false;
  return doc.creatorId === session.userId ||
    doc.ownerId === session.userId ||
    (doc.isShared && session.role === UserRole.ADMIN);
};

// --- MEDIA UPLOAD ---
// Accepts an optimized base64 data URL, writes it to disk under the given
// category folder, and returns the "/uploads/..." URL to store in the DB.
const UPLOAD_CATEGORIES = new Set(["avatars", "assets", "receipts", "documents"]);

app.post("/api/uploads", requireAuth, (req: AuthRequest, res: Response) => {
  const { dataUrl, category, subfolder } = req.body || {};
  if (!UPLOAD_CATEGORIES.has(category)) {
    res.status(400).json({ error: "Loại ảnh tải lên không hợp lệ." });
    return;
  }
  try {
    const saved = saveDataUrlToFile(dataUrl, category, subfolder);
    res.json(saved);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Tải ảnh lên thất bại." });
  }
});

// --- FEATURE FLAGS (family-level) ---
// Điểm thưởng cho trẻ: mặc định BẬT nếu gia đình có tài khoản Trẻ (Con); admin
// bật/tắt thủ công trong Thiết lập sẽ ghi đè mặc định (lưu trong app_settings).
function rewardsFeatureEnabled(): boolean {
  const v = getAppSettings().rewardsEnabled;
  if (v === "1") return true;
  if (v === "0") return false;
  return FamilyDB.getUsers().some(u => u.role === UserRole.CHILD);
}

// --- VERSION & SELF-UPDATE ---

app.get("/api/version", requireAuth, (_req: AuthRequest, res: Response) => {
  res.json({
    version: APP_VERSION,
    commit: GIT_SHA,
    shortCommit: GIT_SHA ? GIT_SHA.slice(0, 7) : "",
    buildTime: BUILD_TIME,
    canAutoUpdate: Boolean(WATCHTOWER_URL && WATCHTOWER_TOKEN),
    aiEnabled: Boolean(getGeminiKey()),
    rewardsEnabled: rewardsFeatureEnabled(),
    rewardApprovalThreshold: Math.max(0, Number(getAppSettings().rewardApprovalThreshold || 0))
  });
});

// Compare the running build's commit against the latest commit on the GitHub branch.
app.get("/api/version/check", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "family-organizer" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const ghRes = await fetch(url, { headers });
    if (!ghRes.ok) throw new Error(`GitHub trả về mã ${ghRes.status}`);
    const data: any = await ghRes.json();
    const latestSha: string = data.sha || "";
    const message: string = (data.commit?.message || "").split("\n")[0];
    const date: string = data.commit?.committer?.date || data.commit?.author?.date || "";
    res.json({
      currentCommit: GIT_SHA ? GIT_SHA.slice(0, 7) : "",
      latestCommit: latestSha ? latestSha.slice(0, 7) : "",
      // null = can't tell (running an un-versioned local/dev build)
      updateAvailable: GIT_SHA ? (Boolean(latestSha) && latestSha !== GIT_SHA) : null,
      latestMessage: message,
      latestDate: date,
      canAutoUpdate: Boolean(WATCHTOWER_URL && WATCHTOWER_TOKEN)
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message || "Không kiểm tra được cập nhật." });
  }
});

// Trigger Watchtower to pull the newest image and restart the app (admin only).
app.post("/api/update", requireAuth, requireRole([UserRole.ADMIN]), async (_req: AuthRequest, res: Response) => {
  if (!WATCHTOWER_URL || !WATCHTOWER_TOKEN) {
    res.status(400).json({ error: "Chưa cấu hình Watchtower trên máy chủ (WATCHTOWER_URL / WATCHTOWER_HTTP_API_TOKEN)." });
    return;
  }
  try {
    const ghRes = await fetch(`${WATCHTOWER_URL.replace(/\/$/, "")}/v1/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WATCHTOWER_TOKEN}` }
    });
    if (!ghRes.ok) throw new Error(`Watchtower trả về mã ${ghRes.status}`);
    res.json({ success: true, message: "Đã yêu cầu cập nhật. Ứng dụng sẽ tải bản mới và khởi động lại trong giây lát." });
  } catch (err: any) {
    res.status(502).json({ error: err.message || "Không kích hoạt được cập nhật tự động." });
  }
});

// --- SERVER MONITOR (thông số máy chủ realtime, admin only) ---
// Chạy trong Docker trên Pi: /proc & /sys phản ánh máy chủ thật nên CPU/RAM/nhiệt độ
// là số liệu của cả con Pi, không phải riêng container.

let lastCpuSample: { idle: number; total: number; at: number } | null = null;

const readCpuTimes = () => {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total, at: Date.now() };
};

// % CPU trung bình giữa 2 lần gọi (client poll ~2s nên delta rất mượt).
// Lần đầu (hoặc mẫu quá cũ) thì tự lấy 2 mẫu cách nhau 300ms.
const readCpuPercent = async (): Promise<number | null> => {
  let prev = lastCpuSample;
  if (!prev || Date.now() - prev.at > 30000) {
    prev = readCpuTimes();
    await new Promise(r => setTimeout(r, 300));
  }
  const cur = readCpuTimes();
  lastCpuSample = cur;
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (dTotal <= 0) return null;
  return Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100));
};

// Nhiệt độ CPU từ thermal zone (Pi/Linux, giá trị millidegree); nơi khác trả null.
// Ưu tiên zone có type cpu/soc (Pi 5 = "cpu-thermal"), nếu không thì lấy zone đầu tiên đọc được.
const readCpuTempC = async (): Promise<number | null> => {
  try {
    const base = "/sys/class/thermal";
    let fallback: number | null = null;
    for (const zone of await fsp.readdir(base)) {
      if (!zone.startsWith("thermal_zone")) continue;
      try {
        const raw = await fsp.readFile(path.join(base, zone, "temp"), "utf8");
        const value = Number(raw.trim());
        if (!Number.isFinite(value) || value <= 0) continue;
        const celsius = value >= 1000 ? value / 1000 : value;
        let type = "";
        try { type = (await fsp.readFile(path.join(base, zone, "type"), "utf8")).trim().toLowerCase(); } catch { /* zone không có type */ }
        if (/cpu|soc|core|x86/.test(type)) return celsius;
        if (fallback === null) fallback = celsius;
      } catch { /* zone không đọc được → thử zone kế */ }
    }
    return fallback;
  } catch { /* không phải Linux hoặc /sys bị ẩn */ }
  return null;
};

// Nhiệt độ SSD NVMe qua hwmon (Pi 5 + SSD có cảm biến: name = "nvme",
// temp1_input thường là "Composite" — nhiệt độ tổng của ổ, đơn vị millidegree).
const readSsdTempC = async (): Promise<number | null> => {
  try {
    const base = "/sys/class/hwmon";
    for (const dev of await fsp.readdir(base)) {
      try {
        const name = (await fsp.readFile(path.join(base, dev, "name"), "utf8")).trim().toLowerCase();
        if (!name.includes("nvme")) continue;
        for (const file of ["temp1_input", "temp2_input", "temp3_input"]) {
          try {
            const raw = await fsp.readFile(path.join(base, dev, file), "utf8");
            const value = Number(raw.trim());
            if (Number.isFinite(value) && value > 0) return value >= 1000 ? value / 1000 : value;
          } catch { /* sensor này không có → thử sensor kế */ }
        }
      } catch { /* hwmon không đọc được → thử cái kế */ }
    }
  } catch { /* không phải Linux hoặc /sys bị ẩn */ }
  return null;
};

// RAM: ưu tiên MemAvailable trong /proc/meminfo (sát thực tế hơn os.freemem trên Linux).
const readMemory = async () => {
  const totalBytes = os.totalmem();
  let availableBytes = os.freemem();
  try {
    const info = await fsp.readFile("/proc/meminfo", "utf8");
    const m = info.match(/MemAvailable:\s+(\d+)\s*kB/);
    if (m) availableBytes = Number(m[1]) * 1024;
  } catch { /* Windows/macOS: dùng os.freemem() */ }
  return { totalBytes, usedBytes: Math.max(0, totalBytes - availableBytes), availableBytes };
};

// Dung lượng phân vùng chứa app (trong container = ổ đĩa thật của máy chủ).
const readDisk = async () => {
  try {
    if (typeof fsp.statfs !== "function") return null; // Node < 18.15
    const st = await fsp.statfs(process.cwd());
    const totalBytes = Number(st.blocks) * Number(st.bsize);
    const freeBytes = Number(st.bavail) * Number(st.bsize);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes };
  } catch {
    return null;
  }
};

// Ghi telemetry vào SQLite 1 phút/lần (24/7) để biểu đồ giữ được lịch sử
// 24h/7 ngày qua các lần reload trang — client không cần poll dày.
async function recordServerMetric() {
  try {
    const [cpuPercent, tempC, ssdTempC, memory, disk] = await Promise.all([
      readCpuPercent(),
      readCpuTempC(),
      readSsdTempC(),
      readMemory(),
      readDisk()
    ]);
    sqliteAppendServerMetric({
      t: Date.now(),
      cpu: cpuPercent,
      ram: memory ? (memory.usedBytes / memory.totalBytes) * 100 : null,
      temp: tempC,
      ssd: ssdTempC,
      disk: disk ? (disk.usedBytes / disk.totalBytes) * 100 : null
    });
  } catch (e) {
    console.error("Không ghi được telemetry máy chủ:", e);
  }
}
setTimeout(recordServerMetric, 10 * 1000);
setInterval(recordServerMetric, 60 * 1000);

// Danh sách shortcut dịch vụ homelab (Immich, Portainer…) lưu trong app_settings.
// Admin quản lý (GET xem, PUT ghi toàn bộ mảng).
interface HomelabLink { id: string; emoji: string; name: string; url: string; desc?: string }
const parseHomelabLinks = (): HomelabLink[] => {
  try { return JSON.parse(getAppSettings().homelabLinks || "[]"); } catch { return []; }
};
app.get("/api/server/homelab-links", requireAuth, requireRole([UserRole.ADMIN]), (_req: AuthRequest, res: Response) => {
  res.json({ links: parseHomelabLinks() });
});
app.put("/api/server/homelab-links", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const links = req.body?.links;
  if (!Array.isArray(links)) { res.status(400).json({ error: "links phải là mảng" }); return; }
  const clean: HomelabLink[] = links.map((l: any) => ({
    id: String(l.id || `hl_${Date.now()}_${Math.random().toString(36).slice(2,6)}`),
    emoji: String(l.emoji || "🔗").trim().slice(0, 8),
    name: String(l.name || "").trim().slice(0, 60),
    url: String(l.url || "").trim().slice(0, 500),
    desc: l.desc ? String(l.desc).trim().slice(0, 120) : undefined
  })).filter(l => l.name && l.url);
  setAppSetting("homelabLinks", JSON.stringify(clean));
  res.json({ links: clean });
});

// Lịch sử telemetry cho biểu đồ: 24h (mặc định) hoặc 7 ngày, downsample ≤320 điểm.
app.get("/api/server/history", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const range = req.query.range === "7d" ? "7d" : "24h";
  const sinceMs = Date.now() - (range === "7d" ? 7 * 24 : 24) * 3600 * 1000;
  const all = sqliteGetServerMetrics(sinceMs);
  const MAX_POINTS = 320;
  const step = Math.ceil(all.length / MAX_POINTS);
  const points = step > 1 ? all.filter((_, i) => i % step === 0 || i === all.length - 1) : all;
  res.json({ range, points });
});

// Các địa chỉ IPv4 của máy (không tính loopback). Gắn nhãn Tailscale theo dải
// CGNAT 100.64.0.0/10 hoặc tên card "tailscale*"; dải 172.16–31 trong container
// thường là mạng bridge của Docker.
const listNetworkAddrs = () => {
  const out: { name: string; address: string; kind: "tailscale" | "docker" | "lan" }[] = [];
  const isTailscaleIp = (ip: string) => {
    const m = ip.match(/^100\.(\d+)\./);
    return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
  };
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal || a.family !== "IPv4") continue;
      const kind = (isTailscaleIp(a.address) || name.startsWith("tailscale")) ? "tailscale"
        : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? "docker"
        : "lan";
      out.push({ name, address: a.address, kind });
    }
  }
  return out;
};

// IP của client đang gọi (qua reverse proxy thì lấy hop đầu của x-forwarded-for).
const readClientIp = (req: Request): string => {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = fwd || req.socket.remoteAddress || "";
  return raw.replace(/^::ffff:/, "");
};

// Dung lượng dữ liệu app: file SQLite (+wal/shm) đọc mỗi lần, thư mục uploads
// walk đệ quy nhưng cache 5 phút (có thể nhiều file media).
let uploadsSizeCache: { at: number; bytes: number } | null = null;
async function readDataSizes(): Promise<{ dbBytes: number; uploadsBytes: number }> {
  let dbBytes = 0;
  for (const f of ["family.db", "family.db-wal", "family.db-shm"]) {
    try { dbBytes += (await fsp.stat(path.join(process.cwd(), "data", f))).size; } catch { /* file chưa tồn tại */ }
  }
  if (!uploadsSizeCache || Date.now() - uploadsSizeCache.at > 5 * 60 * 1000) {
    let bytes = 0;
    const walk = async (dir: string) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else { try { bytes += (await fsp.stat(p)).size; } catch { /* file vừa bị xóa */ } }
      }
    };
    await walk(UPLOADS_DIR);
    uploadsSizeCache = { at: Date.now(), bytes };
  }
  return { dbBytes, uploadsBytes: uploadsSizeCache.bytes };
}

app.get("/api/server/stats", requireAuth, requireRole([UserRole.ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const [cpuPercent, tempC, ssdTempC, memory, disk, dataSizes] = await Promise.all([
      readCpuPercent(),
      readCpuTempC(),
      readSsdTempC(),
      readMemory(),
      readDisk(),
      readDataSizes()
    ]);
    const cpus = os.cpus();
    res.json({
      at: new Date().toISOString(),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.arch()}`,
      uptimeSec: Math.round(os.uptime()),
      loadAvg: os.loadavg(),
      cpu: { percent: cpuPercent, cores: cpus.length, model: cpus[0]?.model || "" },
      tempC,
      ssdTempC,
      memory,
      disk,
      // Mạng & truy cập
      network: { interfaces: listNetworkAddrs(), clientIp: readClientIp(req) },
      // Ứng dụng & dữ liệu
      app: {
        version: APP_VERSION,
        commit: GIT_SHA ? GIT_SHA.slice(0, 7) : "",
        nodeVersion: process.version,
        processUptimeSec: Math.round(process.uptime()),
        rssBytes: process.memoryUsage.rss()
      },
      data: {
        ...dataSizes,
        pushDevices: FamilyDB.getPushSubscriptions().length,
        sseClients: sseClients.length,
        users: FamilyDB.getUsers().length
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Không đọc được thông số máy chủ." });
  }
});

// --- AI SETTINGS (Gemini API key, admin only) ---

app.get("/api/settings/ai", requireAuth, requireRole([UserRole.ADMIN]), (_req: AuthRequest, res: Response) => {
  res.json(aiStatus());
});

// Save (and validate) a Gemini key, or clear it by sending an empty value.
app.post("/api/settings/ai", requireAuth, requireRole([UserRole.ADMIN]), async (req: AuthRequest, res: Response) => {
  const apiKey = String(req.body?.apiKey ?? "").trim();

  if (!apiKey) {
    setAppSetting("geminiApiKey", null);
    res.json({ ...aiStatus(), message: "Đã xóa key trong app. Sẽ dùng key từ biến môi trường (nếu có)." });
    return;
  }

  try {
    await testGeminiKey(apiKey);
  } catch (err: any) {
    res.status(400).json({ error: "Key không dùng được (gọi thử Gemini thất bại): " + (err?.message || "lỗi không rõ") });
    return;
  }

  setAppSetting("geminiApiKey", apiKey);
  res.json({ ...aiStatus(), message: "Đã lưu Gemini API key. Tính năng AI đã sẵn sàng." });
});

// --- FEATURE TOGGLES (admin only) ---
// Bật/tắt tính năng "Điểm thưởng cho trẻ" cho cả nhà. Gửi { rewards: boolean }.
app.post("/api/settings/features", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const { rewards, rewardApprovalThreshold } = req.body || {};
  if (rewards !== undefined) setAppSetting("rewardsEnabled", rewards ? "1" : "0");
  // Ngưỡng tự duyệt: task của trẻ có điểm ≤ ngưỡng thì bấm xong tự cộng luôn;
  // lớn hơn thì phải chờ ba mẹ duyệt. 0 = mọi task có điểm đều cần duyệt.
  if (rewardApprovalThreshold !== undefined) {
    const n = Math.max(0, Math.floor(Number(rewardApprovalThreshold) || 0));
    setAppSetting("rewardApprovalThreshold", n > 0 ? String(n) : null);
  }
  broadcastSyncEvent("SETTINGS_UPDATE");
  res.json({
    rewardsEnabled: rewardsFeatureEnabled(),
    rewardApprovalThreshold: Math.max(0, Number(getAppSettings().rewardApprovalThreshold || 0))
  });
});

// --- TELEGRAM BACKUP SETTINGS (admin only) ---
// Backup toàn phần tự gửi qua bot Telegram hằng đêm (2h–4h sáng) — bản sao offsite.

app.get("/api/settings/telegram-backup", requireAuth, requireRole([UserRole.ADMIN]), (_req: AuthRequest, res: Response) => {
  res.json(telegramBackupStatus());
});

app.post("/api/settings/telegram-backup", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const { botToken, chatId, enabled, weeklyDigestEnabled } = req.body || {};
  // botToken/chatId chỉ ghi đè khi client gửi lên (giữ nguyên khi chỉ bật/tắt).
  if (botToken !== undefined) setAppSetting("telegramBotToken", String(botToken).trim() || null);
  if (chatId !== undefined) setAppSetting("telegramChatId", String(chatId).trim() || null);
  if (enabled !== undefined) setAppSetting("telegramBackupEnabled", enabled ? "1" : null);
  if (weeklyDigestEnabled !== undefined) setAppSetting("telegramWeeklyDigestEnabled", weeklyDigestEnabled ? "1" : null);
  res.json(telegramBackupStatus());
});

// Gửi thử ngay 1 bản backup (kiểm tra token/chat id đúng chưa).
app.post("/api/settings/telegram-backup/test", requireAuth, requireRole([UserRole.ADMIN]), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await sendBackupToTelegram();
    res.json({ success: true, message: `Đã gửi backup ${result.sizeMb}MB qua Telegram — kiểm tra chat của bạn nhé.`, ...telegramBackupStatus() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Gửi backup qua Telegram thất bại." });
  }
});

// Gửi thử bản tin tuần ngay (không chờ thứ Hai).
app.post("/api/settings/telegram-digest/test", requireAuth, requireRole([UserRole.ADMIN]), async (_req: AuthRequest, res: Response) => {
  try {
    const { aiUsed } = await sendWeeklyDigest();
    res.json({ success: true, message: `Đã gửi bản tin tuần${aiUsed ? " (AI)" : ""} — kiểm tra chat Telegram nhé.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Gửi bản tin tuần thất bại." });
  }
});

// Vòng kiểm tra gửi backup + bản tin tuần (mỗi 30 phút, module tự lo dedupe + khung giờ).
setInterval(() => { void runTelegramBackupTick(); void runWeeklyDigestTick(); }, 30 * 60 * 1000);

// --- AUTH API ENDPOINTS ---

app.post("/api/auth/login", (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ip = req.ip || "unknown";

  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Bạn đã thử đăng nhập sai quá nhiều lần. Vui lòng đợi vài phút rồi thử lại!" });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ error: "Vui lòng nhập đầy đủ tài khoản và mật khẩu!" });
    return;
  }

  const users = FamilyDB.getUsers();
  const user = users.find(u => u.username === username.toLowerCase().trim());

  if (!user || user.isDeleted || !verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(ip);
    res.status(401).json({ error: "Tài khoản hoặc mật khẩu không chính xác!" });
    return;
  }

  // Successful login clears the failure counter
  loginAttempts.delete(ip);

  // Record login activity
  FamilyDB.logActivity(user.id, user.username, "Đăng nhập", `Đã đăng nhập thành công vào hệ thống.`);

  // Refresh birthday reminders on each login so they stay current
  try {
    FamilyDB.generateBirthdayNotifications();
  } catch (e) {
    console.error("Lỗi tạo nhắc sinh nhật:", e);
  }

  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token: signToken(user.id) });
});

app.get("/api/auth/me", (req: AuthRequest, res: Response) => {
  if (!req.userSession) {
    res.status(401).json({ error: "Không tìm thấy phiên làm việc!" });
    return;
  }
  const users = FamilyDB.getUsers();
  const user = users.find(u => u.id === req.userSession?.userId);
  if (!user) {
    res.status(404).json({ error: "Không tìm thấy người dùng!" });
    return;
  }
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post("/api/auth/change-password", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Vui lòng nhập mật khẩu hiện tại và mật khẩu mới!" });
    return;
  }

  try {
    FamilyDB.changePassword(session.userId, currentPassword, newPassword);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- REALTIME SSE CONNECTION FOR REPLICATION ---

app.get("/api/realtime", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  // Pulse to keep alive
  res.write(`data: ${JSON.stringify({ type: "init", message: "Đã thiết lập kết nối thời gian thực" })}\n\n`);

  sseClients.push(res);

  req.on("close", () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// --- TASK API ENDPOINTS ---

app.get("/api/tasks", requireAuth, (req: AuthRequest, res: Response) => {
  const tasks = FamilyDB.getTasks();
  res.json({ tasks });
});

app.post("/api/tasks", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  
  // Guard write permissions - Child/Guest can only edit tasks they created or are assigned to.
  if (isLimitedViewer(session.role) && req.body.id && !req.body.comments) {
    const existing = FamilyDB.getTasks().find(t => t.id === req.body.id);
    if (existing && existing.creatorId !== session.userId && existing.assigneeId !== session.userId) {
      res.status(403).json({ error: "Bạn chỉ được sửa đổi công việc do mình tạo hoặc được giao!" });
      return;
    }
  }

  // Chống 2 người cùng sửa đè nhau (chỉ khi form gửi kèm baseUpdatedAt)
  if (req.body.id) {
    const existing = FamilyDB.getTasks().find(t => t.id === req.body.id);
    if (hasEditConflict(existing, req.body)) {
      res.status(409).json({ error: CONFLICT_MSG, conflict: true });
      return;
    }
  }

  try {
    const savedTask = FamilyDB.saveTask(req.body, session.userId, session.username);
    broadcastSyncEvent("TASKS_UPDATE", { taskId: savedTask.id });
    res.json({ task: savedTask });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/comments", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  const { content } = req.body;

  if (!content || content.trim() === "") {
    res.status(400).json({ error: "Nội dung bình luận không được bỏ trống!" });
    return;
  }

  try {
    const updatedTask = FamilyDB.addCommentToTask(id, content, session.userId, session.username);
    broadcastSyncEvent("TASKS_UPDATE", { taskId: id });
    res.json({ task: updatedTask });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Người lớn DUYỆT việc trẻ đã báo hoàn thành (chờ duyệt) → cộng điểm cho trẻ.
app.post("/api/tasks/:id/approve", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const task = FamilyDB.approveTaskCompletion(req.params.id, session.userId, session.username);
    broadcastSyncEvent("TASKS_UPDATE", { taskId: task.id });
    broadcastSyncEvent("REWARDS_UPDATE", { taskId: task.id });
    res.json({ task });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Người lớn TRẢ LẠI việc trẻ báo xong (kèm lý do) → trẻ làm lại, không cộng điểm.
app.post("/api/tasks/:id/reject", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const task = FamilyDB.rejectTaskCompletion(req.params.id, session.userId, session.username, req.body?.reason);
    broadcastSyncEvent("TASKS_UPDATE", { taskId: task.id });
    res.json({ task });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;

  try {
    FamilyDB.deleteTask(id, session.userId, session.username);
    broadcastSyncEvent("TASKS_UPDATE", { deletedId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- PLANS / SCHEDULE API ENDPOINTS ---

app.get("/api/plans", requireAuth, (req: AuthRequest, res: Response) => {
  const plans = FamilyDB.getPlans();
  res.json({ plans });
});

app.post("/api/plans", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER, UserRole.CHILD]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const planData = req.body;

  if (planData.id) {
    const existing = FamilyDB.getPlans().find(p => p.id === planData.id);
    if (existing && existing.creatorId !== session.userId && session.role !== UserRole.ADMIN) {
      res.status(403).json({ error: "Bạn chỉ có thể chỉnh sửa sự kiện do mình tạo. Admin có toàn quyền chỉnh sửa lịch." });
      return;
    }
  }

  try {
    const savedPlan = FamilyDB.savePlan(planData, session.userId, session.username);
    broadcastSyncEvent("PLANS_UPDATE", { planId: savedPlan.id });
    res.json({ plan: savedPlan });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/plans/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER, UserRole.CHILD]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  const existing = FamilyDB.getPlans().find(p => p.id === id);

  if (existing && existing.creatorId !== session.userId && session.role !== UserRole.ADMIN) {
    res.status(403).json({ error: "Bạn chỉ có thể xóa sự kiện do mình tạo. Admin có toàn quyền quản lý lịch." });
    return;
  }

  try {
    FamilyDB.deletePlan(id, session.userId, session.username);
    broadcastSyncEvent("PLANS_UPDATE", { deletedId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- ICS SUBSCRIBE FEED (Apple/Google Calendar tự đồng bộ lịch gia đình) ---

// Cho thành viên lấy URL đăng ký (kèm token) để dán vào app lịch.
app.get("/api/calendar/feed-info", requireAuth, (_req: AuthRequest, res: Response) => {
  res.json({ path: "/api/calendar.ics", token: icsFeedToken() });
});

// Feed công khai qua token (calendar app không gửi được header Authorization).
app.get("/api/calendar.ics", (req: Request, res: Response) => {
  if (!isValidIcsToken(req.query.token)) {
    res.status(401).send("Invalid token");
    return;
  }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="family-calendar.ics"');
  res.setHeader("Cache-Control", "no-cache");
  res.send(buildIcsFeed());
});

// --- NOTES API ENDPOINTS ---

app.get("/api/notes", requireAuth, (req: AuthRequest, res: Response) => {
  const notes = FamilyDB.getNotes();
  res.json({ notes });
});

app.post("/api/notes", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const noteData = req.body;

  // Role validation for modification
  if (noteData.id) {
    const existing = FamilyDB.getNotes().find(n => n.id === noteData.id);
    if (existing) {
      // Check author or edit permission
      if (existing.creatorId !== session.userId && !existing.allowedRolesToEdit.includes(session.role)) {
        res.status(403).json({ error: "Bạn không có quyền sửa ghi chú này!" });
        return;
      }
      if (hasEditConflict(existing, noteData)) {
        res.status(409).json({ error: CONFLICT_MSG, conflict: true });
        return;
      }
    }
  }

  try {
    const savedNote = FamilyDB.saveNote(noteData, session.userId, session.username);
    broadcastSyncEvent("NOTES_UPDATE", { noteId: savedNote.id });
    res.json({ note: savedNote });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/notes/:id", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;

  const existing = FamilyDB.getNotes().find(n => n.id === id);
  if (!existing) {
    res.status(404).json({ error: "Không tìm thấy ghi chú" });
    return;
  }

  if (existing.creatorId !== session.userId && session.role !== UserRole.ADMIN) {
    res.status(403).json({ error: "Chỉ người tạo hoặc Admin mới được xóa ghi chú này!" });
    return;
  }

  try {
    FamilyDB.deleteNote(id, session.userId, session.username);
    broadcastSyncEvent("NOTES_UPDATE", { deletedId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- TÌM KIẾM TOÀN CỤC ---
// Gộp kết quả từ tasks + lịch + ghi chú + thu chi + giấy tờ trong MỘT request.
// So khớp không phân biệt hoa/thường & bỏ dấu tiếng Việt ("giay to" khớp "Giấy tờ").
// Quyền xem soi đúng theo từng route GET gốc: thu chi + giấy tờ chỉ Admin/Member,
// giấy tờ lọc thêm canViewDocument; các nhóm còn lại mọi thành viên đều thấy.

interface SearchResultItem {
  kind: "task" | "plan" | "note" | "transaction" | "document";
  id: string;
  title: string;
  snippet: string;
  date: string; // ngày hiển thị (YYYY-MM-DD...) — để client format
  tab: string;  // tab đích khi bấm vào kết quả
}

const SEARCH_LIMIT_PER_KIND = 6;

app.get("/api/search", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const q = normalizeSearchText(String(req.query.q || ""));
  if (q.length < 2) {
    res.json({ results: [], query: q });
    return;
  }

  const results: SearchResultItem[] = [];
  const take = <T,>(list: T[], map: (x: T) => SearchResultItem) =>
    list.slice(0, SEARCH_LIMIT_PER_KIND).forEach(x => results.push(map(x)));

  // Công việc — title/description/tags (route GET gốc trả tất cả cho mọi role)
  take(
    FamilyDB.getTasks().filter(t => matchesQuery(q, t.title, t.description, t.tags)),
    t => ({
      kind: "task", id: t.id, title: t.title,
      snippet: excerptAround(t.description, q) || "Công việc",
      date: t.dueDate || t.createdAt, tab: "tasks"
    })
  );

  // Lịch / sự kiện — title/description
  take(
    FamilyDB.getPlans().filter(p => matchesQuery(q, p.title, p.description)),
    p => ({
      kind: "plan", id: p.id, title: p.title,
      snippet: excerptAround(p.description, q) || "Sự kiện",
      date: p.startDate, tab: "plans"
    })
  );

  // Ghi chú — title/content/tags
  take(
    FamilyDB.getNotes().filter(n => matchesQuery(q, n.title, n.content, n.tags)),
    n => ({
      kind: "note", id: n.id, title: n.title,
      snippet: excerptAround(n.content, q) || "Ghi chú",
      date: n.updatedAt || n.createdAt, tab: "notes"
    })
  );

  // Thu chi + Giấy tờ: chỉ Admin/Member (khớp quyền các route gốc)
  if (session.role === UserRole.ADMIN || session.role === UserRole.MEMBER) {
    take(
      FamilyDB.getTransactions().filter(tx =>
        matchesQuery(q, tx.description, tx.category, String(tx.amount))
      ),
      tx => ({
        kind: "transaction", id: tx.id,
        title: tx.description || "(không có mô tả)",
        snippet: `${tx.type === "income" ? "Thu" : "Chi"} ${Number(tx.amount).toLocaleString("vi-VN")} đ`,
        date: tx.date, tab: "finance"
      })
    );

    take(
      FamilyDB.getDocuments()
        .filter(doc => canViewDocument(doc, session))
        .filter(doc => matchesQuery(q, doc.title, doc.documentNumber, doc.issuer, doc.notes)),
      doc => ({
        kind: "document", id: doc.id, title: doc.title,
        snippet: [DOCUMENT_TYPE_LABELS[doc.type] || "Giấy tờ", doc.documentNumber].filter(Boolean).join(" • "),
        date: doc.expiryDate || doc.updatedAt || doc.createdAt, tab: "documents"
      })
    );
  }

  res.json({ results, query: q });
});

// --- FINANCIAL API ENDPOINTS ---

app.get("/api/finance", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const transactions = FamilyDB.getTransactions();
  res.json({ transactions });
});

app.post("/api/finance", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const savedTx = FamilyDB.saveTransaction(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { txId: savedTx.id });
    res.json({ transaction: savedTx });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;

  try {
    FamilyDB.deleteTransaction(id, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { deletedId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- REWARDS API ENDPOINTS ---

app.get("/api/rewards", requireAuth, (req: AuthRequest, res: Response) => {
  const entries = FamilyDB.getRewardLedger();
  const totals: Record<string, number> = {};
  entries.forEach(entry => {
    totals[entry.userId] = (totals[entry.userId] || 0) + entry.points;
  });
  res.json({ entries, totals, items: FamilyDB.getRewardItems() });
});

app.post("/api/rewards", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const entry = FamilyDB.addRewardEntry(req.body, session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { rewardId: entry.id });
    res.json({ entry });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Cửa hàng đổi thưởng: người lớn quản lý danh sách quà
app.post("/api/rewards/items", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const item = FamilyDB.saveRewardItem(req.body, session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { itemId: item.id });
    res.json({ item });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/rewards/items/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    FamilyDB.deleteRewardItem(req.params.id, session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { deletedItemId: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Đổi quà: trẻ tự đổi cho mình; người lớn có thể đổi hộ (gửi childId)
app.post("/api/rewards/items/:id/redeem", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const isAdult = session.role === UserRole.ADMIN || session.role === UserRole.MEMBER;
  const childId = isAdult && req.body?.childId ? String(req.body.childId) : session.userId;
  try {
    const entry = FamilyDB.redeemRewardItem(req.params.id, childId, session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { rewardId: entry.id });
    res.json({ entry });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Thêm mẫu quà mặc định nếu cửa hàng đang trống (idempotent).
app.post("/api/rewards/items/seed-defaults", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const items = FamilyDB.seedDefaultRewardItems(session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { seeded: true });
    res.json({ items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Đổi quà bất ngờ: server chọn ngẫu nhiên + tính giá mystery (giảm ~30%).
app.post("/api/rewards/items/mystery", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const isAdult = session.role === UserRole.ADMIN || session.role === UserRole.MEMBER;
  const childId = isAdult && req.body?.childId ? String(req.body.childId) : session.userId;
  try {
    const result = FamilyDB.redeemMysteryItem(childId, session.userId, session.username);
    broadcastSyncEvent("REWARDS_UPDATE", { rewardId: result.entry.id });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- BUDGET + RECURRING BILL API ENDPOINTS ---

app.get("/api/finance/budgets", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  res.json({ budgets: FamilyDB.getBudgets() });
});

app.post("/api/finance/budgets", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const budget = FamilyDB.saveBudget(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { budgetId: budget.id });
    res.json({ budget });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/finance/budgets/carry-forward", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const copied = FamilyDB.carryForwardBudgets(req.body.month, session.userId, session.username);
    if (copied.length > 0) broadcastSyncEvent("FINANCE_UPDATE", { carriedForward: copied.length });
    res.json({ budgets: FamilyDB.getBudgets(), copied: copied.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/budgets/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  FamilyDB.deleteBudget(req.params.id);
  broadcastSyncEvent("FINANCE_UPDATE", { deletedBudgetId: req.params.id });
  res.json({ success: true });
});

// Hạng mục CHI: đọc cho mọi người dùng tài chính (để render/chọn); chỉnh sửa chỉ Admin.
app.get("/api/finance/categories", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (_req: AuthRequest, res: Response) => {
  res.json(FamilyDB.getCategoryConfig());
});

app.post("/api/finance/categories", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const category = FamilyDB.saveCustomCategory(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { categoryId: category.id });
    res.json({ category, ...FamilyDB.getCategoryConfig() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/categories/:id", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  FamilyDB.deleteCustomCategory(req.params.id, session.userId, session.username);
  broadcastSyncEvent("FINANCE_UPDATE", { deletedCategoryId: req.params.id });
  res.json({ success: true, ...FamilyDB.getCategoryConfig() });
});

app.put("/api/finance/categories/hidden", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const hiddenBuiltinCategories = FamilyDB.setHiddenBuiltinCategories(req.body?.hidden, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { hiddenCategories: hiddenBuiltinCategories.length });
    res.json({ hiddenBuiltinCategories });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/finance/recurring-bills", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  res.json({ recurringBills: FamilyDB.getRecurringBills() });
});

app.post("/api/finance/recurring-bills", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const bill = FamilyDB.saveRecurringBill(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { billId: bill.id });
    res.json({ bill });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/finance/recurring-bills/:id/pay", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const result = FamilyDB.payRecurringBill(req.params.id, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { billId: result.bill.id, txId: result.transaction.id });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/recurring-bills/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  FamilyDB.deleteRecurringBill(req.params.id);
  broadcastSyncEvent("FINANCE_UPDATE", { deletedBillId: req.params.id });
  res.json({ success: true });
});

// --- MỤC TIÊU TIẾT KIỆM ---
app.get("/api/finance/savings-goals", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const savingsGoals = FamilyDB.getSavingsGoals().filter(goal => canViewSavingsGoal(goal, session));
  res.json({ savingsGoals });
});

app.post("/api/finance/savings-goals", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  if (req.body?.id) {
    const existing = FamilyDB.getSavingsGoals().find(g => g.id === req.body.id);
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy mục tiêu tiết kiệm" });
      return;
    }
    if (!canManageSavingsGoal(existing, session)) {
      res.status(403).json({ error: "Bạn không có quyền sửa mục tiêu tiết kiệm này." });
      return;
    }
  }
  try {
    const goal = FamilyDB.saveSavingsGoal(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { savingsGoalId: goal.id });
    res.json({ goal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/savings-goals/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const existing = FamilyDB.getSavingsGoals().find(g => g.id === req.params.id);
  if (existing && !canManageSavingsGoal(existing, session)) {
    res.status(403).json({ error: "Bạn không có quyền xóa mục tiêu tiết kiệm này." });
    return;
  }
  try {
    FamilyDB.deleteSavingsGoal(req.params.id, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { deletedGoalId: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/finance/savings-goals/:id/contributions", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const existing = FamilyDB.getSavingsGoals().find(g => g.id === req.params.id);
  if (existing && !canViewSavingsGoal(existing, session)) {
    res.status(403).json({ error: "Bạn không có quyền ghi nhận mục tiêu tiết kiệm này." });
    return;
  }
  try {
    const goal = FamilyDB.addSavingsContribution(req.params.id, req.body, session.userId);
    broadcastSyncEvent("FINANCE_UPDATE", { savingsGoalId: goal.id });
    res.json({ goal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/savings-goals/:id/contributions/:cid", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const existing = FamilyDB.getSavingsGoals().find(g => g.id === req.params.id);
  const contribution = existing?.contributions.find(c => c.id === req.params.cid);
  if (existing && (!canViewSavingsGoal(existing, session) || (!canManageSavingsGoal(existing, session) && contribution?.byId !== session.userId))) {
    res.status(403).json({ error: "Bạn không có quyền xóa lần ghi nhận này." });
    return;
  }
  try {
    const goal = FamilyDB.removeSavingsContribution(req.params.id, req.params.cid);
    broadcastSyncEvent("FINANCE_UPDATE", { savingsGoalId: goal.id });
    res.json({ goal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- VAY / CHO MƯỢN (NỢ) ---
app.get("/api/finance/debts", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (_req: AuthRequest, res: Response) => {
  res.json({ debts: FamilyDB.getDebts() });
});

app.post("/api/finance/debts", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const debt = FamilyDB.saveDebt(req.body, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { debtId: debt.id });
    res.json({ debt });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/debts/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  FamilyDB.deleteDebt(req.params.id, session.userId, session.username);
  broadcastSyncEvent("FINANCE_UPDATE", { deletedDebtId: req.params.id });
  res.json({ success: true });
});

app.post("/api/finance/debts/:id/payments", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const debt = FamilyDB.addDebtPayment(req.params.id, req.body, session.userId);
    broadcastSyncEvent("FINANCE_UPDATE", { debtId: debt.id });
    res.json({ debt });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/debts/:id/payments/:pid", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  try {
    const debt = FamilyDB.removeDebtPayment(req.params.id, req.params.pid);
    broadcastSyncEvent("FINANCE_UPDATE", { debtId: debt.id });
    res.json({ debt });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/finance/assets", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  res.json({ assets: FamilyDB.getAssets() });
});

app.post("/api/finance/assets", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const assetData = req.body;

  try {
    validateAssetPhotosPayload(assetData.photos);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (assetData.id) {
    const existing = FamilyDB.getAssets().find(a => a.id === assetData.id);
    if (existing && existing.createdById !== session.userId && session.role !== UserRole.ADMIN) {
      res.status(403).json({ error: "Bạn chỉ có thể chỉnh sửa tài sản do mình tạo. Admin có toàn quyền quản lý tài sản." });
      return;
    }
  }

  try {
    const asset = FamilyDB.saveAsset(assetData, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { assetId: asset.id });
    res.json({ asset });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/assets/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const existing = FamilyDB.getAssets().find(a => a.id === req.params.id);

  if (existing && existing.createdById !== session.userId && session.role !== UserRole.ADMIN) {
    res.status(403).json({ error: "Bạn chỉ có thể xóa tài sản do mình tạo. Admin có toàn quyền quản lý tài sản." });
    return;
  }

  try {
    FamilyDB.deleteAsset(req.params.id, session.userId, session.username);
    broadcastSyncEvent("FINANCE_UPDATE", { deletedAssetId: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- MARKET PRICES API ---

interface MarketPriceCacheData {
  gold: { pricePerGramUsd: number; pricePerGramVnd: number; source: string } | null;
  crypto: Record<string, { usd: number; vnd: number }>;
  usdVndRate: number;
  lastUpdated: string;
  cacheUntil: number;
}

// CoinGecko ID map for common crypto symbols
const CRYPTO_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", USDC: "usd-coin",
  BNB: "binancecoin", SOL: "solana", XRP: "ripple", ADA: "cardano",
  DOGE: "dogecoin", TON: "the-open-network", TRX: "tron", LINK: "chainlink",
  MATIC: "matic-network", DOT: "polkadot", AVAX: "avalanche-2", LTC: "litecoin",
  SHIB: "shiba-inu", UNI: "uniswap", ATOM: "cosmos", NEAR: "near",
  OP: "optimism", ARB: "arbitrum", SUI: "sui", PEPE: "pepe",
  FIL: "filecoin", APT: "aptos", INJ: "injective-protocol", SEI: "sei-network",
  STX: "blockstack", RENDER: "render-token", WIF: "dogwifcoin"
};

// Cache for extended crypto list (30+ coins). Gold + FX are reused from the
// dashboard's cachedFetch("gold") / cachedFetch("fx") — same vang.today source.
let _cryptoCache: { data: Record<string, { usd: number; vnd: number }>; until: number } = {
  data: {}, until: 0
};

async function fetchExtendedCrypto(): Promise<Record<string, { usd: number; vnd: number }>> {
  const now = Date.now();
  if (now < _cryptoCache.until) return _cryptoCache.data;

  try {
    const ids = Object.values(CRYPTO_ID_MAP).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,vnd`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (res.ok) {
      const raw = await res.json() as any;
      const result: Record<string, { usd: number; vnd: number }> = {};
      for (const [symbol, id] of Object.entries(CRYPTO_ID_MAP)) {
        if (raw[id]) {
          const usdPrice = raw[id].usd ?? 0;
          result[symbol] = { usd: usdPrice, vnd: raw[id].vnd ?? usdPrice * 25000 };
        }
      }
      _cryptoCache = { data: result, until: now + 5 * 60 * 1000 };
      return result;
    }
  } catch (err) {
    console.warn("[market-prices] crypto fetch failed:", (err as Error).message);
  }
  // On error keep stale data, retry in 1 min
  _cryptoCache.until = now + 60 * 1000;
  return _cryptoCache.data;
}

app.get("/api/market-prices", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    // Reuse the same cached data as the dashboard (vang.today for SJC gold, open.er-api for FX).
    // cachedFetch / fetchGold / fetchFx are async function declarations — hoisted, safe to call here.
    const [fx, goldRaw, cryptoData] = await Promise.all([
      cachedFetch("fx", 30 * 60 * 1000, fetchFx),
      cachedFetch("gold", 30 * 60 * 1000, () => fetchGold(null)),
      fetchExtendedCrypto()
    ]);

    const usdVndRate: number = fx?.usdVnd ?? 25000;

    // Convert SJC/vang.today gold result into per-unit prices the Assets module needs.
    // goldRaw.sell   = SJC VND/lượng (primary path)
    // goldRaw.vndPerTael = estimated VND/lượng from world price (fallback path)
    // goldRaw.usdPerOz   = world price in USD/troy oz (fallback path, no VND available)
    let gold: { pricePerGramUsd: number; pricePerGramVnd: number; source: string } | null = null;
    if (goldRaw) {
      const pricePerLuongVnd: number | null =
        goldRaw.sell ?? goldRaw.vndPerTael ??
        (goldRaw.usdPerOz ? Math.round((goldRaw.usdPerOz / 31.1035) * 37.5 * usdVndRate) : null);
      if (pricePerLuongVnd && pricePerLuongVnd > 0) {
        const pricePerLuongUsd = pricePerLuongVnd / usdVndRate;
        gold = {
          pricePerGramVnd: pricePerLuongVnd / 37.5,
          pricePerGramUsd: pricePerLuongUsd / 37.5,
          source: goldRaw.source ?? "vang.today"
        };
      }
    }

    res.json({
      gold: gold ? {
        pricePerGramUsd: gold.pricePerGramUsd,
        pricePerGramVnd: gold.pricePerGramVnd,
        pricePerChiUsd: gold.pricePerGramUsd * 3.75,
        pricePerChiVnd: gold.pricePerGramVnd * 3.75,
        pricePerLuongUsd: gold.pricePerGramUsd * 37.5,
        pricePerLuongVnd: gold.pricePerGramVnd * 37.5,
        source: gold.source
      } : null,
      crypto: cryptoData,
      usdVndRate,
      lastUpdated: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: "Không thể lấy giá thị trường." });
  }
});

// --- MEDICATION API ENDPOINTS ---

app.get("/api/medications", requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ medications: FamilyDB.getMedications() });
});

app.post("/api/medications", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const medication = FamilyDB.saveMedication(req.body, session.userId, session.username);
    broadcastSyncEvent("MEDICATIONS_UPDATE", { medicationId: medication.id });
    res.json({ medication });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/medications/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  FamilyDB.deleteMedication(req.params.id);
  broadcastSyncEvent("MEDICATIONS_UPDATE", { deletedId: req.params.id });
  res.json({ success: true });
});

// Nhật ký uống thuốc — danh sách log gần đây (mặc định 30 ngày, hoặc ?since=YYYY-MM-DD)
app.get("/api/medications/logs", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json({ logs: FamilyDB.getMedicationLogs(since) });
});

// Ghi nhận một liều (taken/skipped) hoặc bỏ đánh dấu (none)
app.post("/api/medications/logs", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const result = FamilyDB.logMedicationDose(req.body, session.userId);
    broadcastSyncEvent("MEDICATIONS_UPDATE", { medicationId: req.body?.medicationId });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- KHO GIẤY TỜ API (chỉ Admin/Member) ---

app.get("/api/documents", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const documents = FamilyDB.getDocuments().filter(doc => canViewDocument(doc, session));
  res.json({ documents });
});

app.post("/api/documents", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  if (req.body?.id) {
    const existing = FamilyDB.getDocuments().find(d => d.id === req.body.id);
    if (!existing) {
      res.status(404).json({ error: "Không tìm thấy giấy tờ" });
      return;
    }
    if (!canManageDocument(existing, session)) {
      res.status(403).json({ error: "Bạn không có quyền sửa giấy tờ này." });
      return;
    }
    if (hasEditConflict(existing, req.body)) {
      res.status(409).json({ error: CONFLICT_MSG, conflict: true });
      return;
    }
  }
  try {
    const document = FamilyDB.saveDocument(req.body, session.userId, session.username);
    broadcastSyncEvent("DOCUMENTS_UPDATE", { documentId: document.id });
    res.json({ document });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/documents/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const existing = FamilyDB.getDocuments().find(d => d.id === req.params.id);
  if (existing && !canManageDocument(existing, session)) {
    res.status(403).json({ error: "Bạn không có quyền xóa giấy tờ này." });
    return;
  }
  try {
    FamilyDB.deleteDocument(req.params.id, session.userId, session.username);
    broadcastSyncEvent("DOCUMENTS_UPDATE", { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- SỨC KHỎE TRẺ: TIÊM CHỦNG & TĂNG TRƯỞNG (chỉ Admin/Member) ---
// Sổ sức khỏe cả nhà đều xem được; thêm/sửa/xóa vẫn giới hạn Admin/Member ở các route ghi bên dưới.
app.get("/api/child-health", requireAuth, (_req: AuthRequest, res: Response) => {
  res.json({
    vaccinations: FamilyDB.getVaccinations(),
    growthRecords: FamilyDB.getGrowthRecords(),
    healthProfiles: FamilyDB.getHealthProfiles()
  });
});

// Thẻ khẩn cấp: mọi thành viên xem được (GET ở trên), Admin/Member cập nhật.
app.post("/api/child-health/emergency", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const profile = FamilyDB.saveHealthProfile(req.body, session.userId, session.username);
    broadcastSyncEvent("CHILD_HEALTH_UPDATE", { healthProfileId: profile.id });
    res.json({ profile });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/child-health/vaccinations", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const vaccination = FamilyDB.saveVaccination(req.body, session.userId, session.username);
    broadcastSyncEvent("CHILD_HEALTH_UPDATE", { vaccinationId: vaccination.id });
    res.json({ vaccination });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/child-health/vaccinations/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  FamilyDB.deleteVaccination(req.params.id);
  broadcastSyncEvent("CHILD_HEALTH_UPDATE", { deletedVaccinationId: req.params.id });
  res.json({ success: true });
});

app.post("/api/child-health/growth", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const record = FamilyDB.saveGrowthRecord(req.body, session.userId, session.username);
    broadcastSyncEvent("CHILD_HEALTH_UPDATE", { growthId: record.id });
    res.json({ record });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/child-health/growth/:id", requireAuth, requireRole([UserRole.ADMIN, UserRole.MEMBER]), (req: AuthRequest, res: Response) => {
  FamilyDB.deleteGrowthRecord(req.params.id);
  broadcastSyncEvent("CHILD_HEALTH_UPDATE", { deletedGrowthId: req.params.id });
  res.json({ success: true });
});

// --- AI ASSISTANT API ---

function cleanAssistantText(value: any, maxLength: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseAssistantJson(rawText: string): any | null {
  const text = rawText.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeAssistantActions(actions: any[]): any[] {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((action, actionIndex) => {
      if (!action || action.type !== "create_shopping_items") return null;
      const rawItems = Array.isArray(action.items) ? action.items : [];
      const seen = new Set<string>();
      const items = rawItems
        .map((item: any) => {
          const name = cleanAssistantText(typeof item === "string" ? item : item?.name, 80);
          if (!name) return null;
          const key = name.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            name,
            quantity: cleanAssistantText(item?.quantity, 40),
            note: cleanAssistantText(item?.note, 120)
          };
        })
        .filter(Boolean)
        .slice(0, 20);

      if (items.length === 0) return null;
      return {
        id: `assistant_action_${Date.now()}_${actionIndex}_${Math.random().toString(36).slice(2, 6)}`,
        type: "create_shopping_items",
        title: cleanAssistantText(action.title, 100) || "Thêm nguyên liệu vào danh sách đi chợ",
        items
      };
    })
    .filter(Boolean);
}

app.post("/api/assistant/chat", requireAuth, async (req: AuthRequest, res: Response) => {
  const apiKey = getGeminiKey();
  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "Vui lòng nhập câu hỏi cho trợ lý" });
    return;
  }
  if (!apiKey) {
    res.status(400).json({ error: "Chưa cấu hình Gemini API key. Vào Thiết lập để nhập key." });
    return;
  }

  try {
    const [{ GoogleGenAI }] = await Promise.all([import("@google/genai")]);
    const ai = new GoogleGenAI({ apiKey });
    const tasks = FamilyDB.getTasks().slice(-30).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      assigneeId: t.assigneeId,
      rewardPoints: t.rewardPoints
    }));
    const plans = FamilyDB.getPlans().slice(-30).map(p => ({
      id: p.id,
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      isShared: p.isShared
    }));
    const transactions = FamilyDB.getTransactions().slice(-30).map(({ receiptImage, ...tx }) => tx);
    const medications = FamilyDB.getMedications().map(m => ({
      id: m.id,
      name: m.name,
      dosage: m.dosage,
      patientId: m.patientId,
      times: m.times,
      isActive: m.isActive
    }));
    const shoppingItems = FamilyDB.getShoppingItems()
      .filter(item => !item.isPurchased)
      .slice(0, 80)
      .map(item => ({ name: item.name, quantity: item.quantity, note: item.note }));
    const prompt = [
      "Bạn là trợ lý gia đình trong app Family Organizer. Trả lời ngắn gọn bằng tiếng Việt, ưu tiên việc có thể làm ngay.",
      "Bạn PHẢI trả về duy nhất một JSON object hợp lệ, không bọc markdown, không thêm chữ ngoài JSON.",
      "Schema: {\"reply\":\"câu trả lời cho người dùng\",\"actions\":[{\"type\":\"create_shopping_items\",\"title\":\"tiêu đề hành động\",\"items\":[{\"name\":\"tên món cần mua\",\"quantity\":\"số lượng nếu biết\",\"note\":\"ghi chú nếu cần\"}]}]}",
      "Chỉ tạo action create_shopping_items khi người dùng yêu cầu thêm/tạo/lập danh sách đi chợ, mua sắm, hoặc hỏi menu và nhờ thêm nguyên liệu vào danh sách đi chợ. Nếu chỉ hỏi gợi ý hoặc hỏi thông tin, actions phải là [].",
      "Không tạo quá 20 món. Gộp món trùng nhau. Không tự ý tạo task, giao dịch, thuốc hoặc lịch vì app hiện chỉ cho phép action đi chợ.",
      `Nguoi hoi: ${req.userSession?.fullName}`,
      `Tasks gan day: ${JSON.stringify(tasks)}`,
      `Lich gan day: ${JSON.stringify(plans)}`,
      `Giao dich gan day: ${JSON.stringify(transactions)}`,
      `Lich thuoc: ${JSON.stringify(medications)}`,
      `Danh sach di cho hien tai: ${JSON.stringify(shoppingItems)}`,
      `Cau hoi: ${message}`
    ].join("\n\n");
    const response = await geminiGenerate(ai, {
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    } as any);
    const rawText = response.text || "";
    const parsed = parseAssistantJson(rawText);
    if (!parsed) {
      res.json({ answer: rawText || "Mình chưa có câu trả lời phù hợp.", actions: [] });
      return;
    }
    res.json({
      answer: cleanAssistantText(parsed.reply, 4000) || "Mình đã chuẩn bị gợi ý cho bạn.",
      actions: normalizeAssistantActions(parsed.actions)
    });
  } catch (err: any) {
    console.error("Assistant error:", err);
    res.status(500).json({ error: err.message || "Trợ lý AI đang gặp lỗi" });
  }
});

// AI meal planner → balanced multi-day menu + consolidated grocery list.
// The current shared weekly menu (persisted, synced across the family).
app.get("/api/shopping/meal-plan/current", requireAuth, (_req: AuthRequest, res: Response) => {
  res.json({ mealPlan: FamilyDB.getMealPlan() });
});

// Random balanced plan drawn from the (growing) dish library in the DB. No AI key needed.
// With save:true it becomes the shared weekly menu shown on the shopping view.
app.post("/api/shopping/meal-plan/random", requireAuth, (req: AuthRequest, res: Response) => {
  const adults = Math.min(10, Math.max(0, Math.floor(Number(req.body?.adults) || 0)));
  const children = Math.min(10, Math.max(0, Math.floor(Number(req.body?.children) || 0)));
  const days = Math.min(7, Math.max(1, Math.floor(Number(req.body?.days) || 7)));
  const save = req.body?.save === true;
  if (adults + children <= 0) {
    res.status(400).json({ error: "Cần ít nhất 1 người để lập thực đơn." });
    return;
  }
  try {
    const library = FamilyDB.getDishLibrary();
    const plan = buildPlanFromLibrary(library, { adults, children, days });
    if (save) {
      const stored = {
        days: plan.days,
        groceries: plan.groceries,
        source: plan.source,
        adults,
        children,
        updatedAt: new Date().toISOString(),
        updatedById: req.userSession?.userId || ""
      };
      FamilyDB.setMealPlan(stored);
      broadcastSyncEvent("SHOPPING_UPDATE");
    }
    res.json({ ...plan, dishCount: library.length });
  } catch (err: any) {
    console.error("Random meal-plan error:", err);
    res.status(500).json({ error: err.message || "Không tạo được thực đơn." });
  }
});

app.post("/api/shopping/meal-plan", requireAuth, async (req: AuthRequest, res: Response) => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Chưa cấu hình Gemini API key. Vào Thiết lập để nhập key." });
    return;
  }
  const adults = Math.min(10, Math.max(0, Math.floor(Number(req.body?.adults) || 0)));
  const children = Math.min(10, Math.max(0, Math.floor(Number(req.body?.children) || 0)));
  const days = Math.min(7, Math.max(1, Math.floor(Number(req.body?.days) || 3)));
  const notes = String(req.body?.notes || "").slice(0, 500);
  if (adults + children <= 0) {
    res.status(400).json({ error: "Cần ít nhất 1 người để lập thực đơn." });
    return;
  }

  try {
    const [{ GoogleGenAI }] = await Promise.all([import("@google/genai")]);
    const ai = new GoogleGenAI({ apiKey });
    const prompt = [
      "Bạn là chuyên gia dinh dưỡng kiêm đầu bếp gia đình Việt Nam.",
      `Lập thực đơn cân bằng dinh dưỡng cho gia đình ${adults} người lớn và ${children} trẻ em, trong ${days} ngày, mỗi ngày 3 bữa (Sáng/Trưa/Tối).`,
      "Món Việt quen thuộc, đa dạng giữa các ngày, đủ nhóm chất (đạm, rau củ, tinh bột, trái cây); khẩu phần trẻ em ít hơn người lớn.",
      notes ? `Lưu ý của gia đình (dị ứng/kiêng/ngân sách/sở thích): ${notes}` : "Không có lưu ý đặc biệt.",
      "Sau đó GỘP toàn bộ nguyên liệu của cả thực đơn thành một danh sách đi chợ, cộng dồn số lượng theo số người, ghi số lượng ước tính dễ mua (vd '1.2 kg', '6 quả', 'vừa đủ').",
      "Đồng thời liệt kê các MÓN đã dùng kèm nguyên liệu chính (để lưu vào thư viện món xoay vòng sau này): mỗi món có slot là breakfast (món sáng), main (món mặn chính), side (rau/canh) hoặc fruit (trái cây).",
      "Bạn PHẢI trả về DUY NHẤT một JSON hợp lệ, không bọc markdown, không thêm chữ ngoài JSON.",
      'Schema: {"days":[{"day":1,"meals":[{"meal":"Sáng","dishes":["..."]},{"meal":"Trưa","dishes":["..."]},{"meal":"Tối","dishes":["..."]}]}],"groceries":[{"name":"tên nguyên liệu","cat":"Đạm|Rau củ|Tinh bột|Trái cây|Gia vị","quantity":"số lượng"}],"dishes":[{"name":"tên món","slot":"breakfast|main|side|fruit","ingredients":[{"name":"nguyên liệu","cat":"Đạm|Rau củ|Tinh bột|Trái cây|Gia vị"}]}]}',
      "Trường cat bắt buộc thuộc: Đạm, Rau củ, Tinh bột, Trái cây, Gia vị. Không quá 40 nguyên liệu và 30 món."
    ].join("\n\n");

    // Tắt "thinking" + cấp nhiều output token: thực đơn JSON khá lớn, nếu để
    // gemini-2.5-flash suy nghĩ sẽ ngốn hết token và treo/không ra JSON.
    const response = await geminiGenerate(ai, {
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 }
      }
    } as any);

    const parsed = parseAssistantJson(response.text || "");
    if (!parsed || !Array.isArray(parsed.days) || !Array.isArray(parsed.groceries)) {
      console.error("Meal-plan AI parse fail. finishReason:", (response as any)?.candidates?.[0]?.finishReason, "len:", (response.text || "").length);
      res.status(502).json({ error: "AI trả về dữ liệu không hợp lệ (có thể do quá dài). Hãy giảm số ngày rồi thử lại." });
      return;
    }

    const CATS = ["Đạm", "Rau củ", "Tinh bột", "Trái cây", "Gia vị"];
    const cleanDays = parsed.days.slice(0, 14).map((d: any, i: number) => ({
      day: Number(d?.day) || i + 1,
      meals: Array.isArray(d?.meals)
        ? d.meals.slice(0, 3).map((m: any) => ({
            meal: ["Sáng", "Trưa", "Tối"].includes(String(m?.meal)) ? String(m.meal) : "Bữa",
            dishes: Array.isArray(m?.dishes)
              ? m.dishes.slice(0, 6).map((x: any) => String(x).slice(0, 80)).filter(Boolean)
              : []
          }))
        : []
    }));
    const cleanGroceries = parsed.groceries
      .slice(0, 60)
      .map((g: any) => ({
        name: String(g?.name || "").slice(0, 100),
        cat: CATS.includes(String(g?.cat)) ? String(g.cat) : "Gia vị",
        quantity: String(g?.quantity || "").slice(0, 40)
      }))
      .filter((g: any) => g.name);

    // Chuẩn hoá danh sách MÓN (dùng cho cả học món mới lẫn chú thích buổi/món).
    const SLOTS = ["breakfast", "main", "side", "fruit"];
    const cleanDishes = Array.isArray(parsed.dishes)
      ? parsed.dishes
          .slice(0, 40)
          .map((d: any) => ({
            name: String(d?.name || "").slice(0, 80),
            slot: (SLOTS.includes(String(d?.slot)) ? String(d.slot) : "main") as DishSlot,
            ingredients: Array.isArray(d?.ingredients)
              ? d.ingredients.slice(0, 12).map((ing: any): MealIngredient => ({
                  name: String(ing?.name || "").slice(0, 60),
                  cat: CATS.includes(String(ing?.cat)) ? (String(ing.cat) as MealIngredient["cat"]) : "Gia vị"
                })).filter((ing: MealIngredient) => ing.name)
              : []
          }))
          .filter((d: any) => d.name)
      : [];

    // GỘP nguyên liệu trùng (AI hay lặp) + gắn chú thích "dùng ở buổi/món nào".
    const annotatedGroceries = dedupeAndAnnotateGroceries(cleanGroceries, cleanDays, cleanDishes);

    // Learn new dishes into the library so future random plans get more variety.
    let learned = 0;
    if (cleanDishes.length) {
      try { learned = FamilyDB.addDishesFromAI(cleanDishes); } catch (e) { console.error("Lưu món AI lỗi:", e); }
    }

    // Save as the shared weekly menu shown on the shopping view + sync the family.
    FamilyDB.setMealPlan({
      days: cleanDays,
      groceries: annotatedGroceries as any,
      source: "ai",
      adults,
      children,
      updatedAt: new Date().toISOString(),
      updatedById: req.userSession?.userId || ""
    });
    broadcastSyncEvent("SHOPPING_UPDATE");

    res.json({ days: cleanDays, groceries: annotatedGroceries, source: "ai", learned });
  } catch (err: any) {
    console.error("Meal-plan error:", err);
    res.status(isGeminiOverloaded(err) ? 503 : 500).json({ error: geminiErrorMessage(err) });
  }
});

// AI viết nháp ghi chú (Markdown) từ mô tả ngắn của người dùng.
app.post("/api/notes/ai-draft", requireAuth, async (req: AuthRequest, res: Response) => {
  if (req.userSession?.role === UserRole.GUEST) {
    res.status(403).json({ error: "Tài khoản khách không thể tạo ghi chú." });
    return;
  }
  const apiKey = getGeminiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Chưa cấu hình Gemini API key. Vào Thiết lập để nhập key." });
    return;
  }
  const promptText = String(req.body?.prompt || "").trim().slice(0, 2000);
  const existingTitle = String(req.body?.title || "").trim().slice(0, 200);
  if (!promptText) {
    res.status(400).json({ error: "Hãy mô tả nội dung ghi chú bạn muốn AI viết." });
    return;
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const prompt = [
      "Bạn là trợ lý viết ghi chú cho một app gia đình. Viết bằng tiếng Việt, rõ ràng, hữu ích, đúng trọng tâm.",
      "Trả về DUY NHẤT một JSON hợp lệ, không bọc markdown, không thêm chữ ngoài JSON.",
      'Schema: {"title":"tiêu đề ngắn gọn","content":"nội dung ở định dạng Markdown (GFM): dùng tiêu đề ##, danh sách, checkbox - [ ], in đậm, bảng khi hợp lý"}',
      existingTitle ? `Tiêu đề gợi ý sẵn: ${existingTitle}` : "Tự đặt tiêu đề phù hợp.",
      `Yêu cầu của người dùng: ${promptText}`
    ].join("\n\n");

    const response = await geminiGenerate(ai, {
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    } as any);

    const parsed = parseAssistantJson(response.text || "");
    const title = cleanAssistantText(parsed?.title, 200) || existingTitle || "Ghi chú mới";
    // Keep newlines/markdown intact — do NOT run through cleanAssistantText (it collapses whitespace).
    const content = String(parsed?.content || "").trim().slice(0, 20000) || (response.text || "").trim();
    if (!content) {
      res.status(502).json({ error: "AI chưa tạo được nội dung. Hãy thử mô tả chi tiết hơn." });
      return;
    }
    res.json({ title, content });
  } catch (err: any) {
    console.error("Notes AI draft error:", err);
    res.status(isGeminiOverloaded(err) ? 503 : 500).json({ error: geminiErrorMessage(err) });
  }
});

// --- SHOPPING LIST ENDPOINTS ---

app.get("/api/shopping", requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ shoppingItems: FamilyDB.getShoppingItems() });
});

app.post("/api/shopping", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  if (!req.body.id && (!req.body.name || !req.body.name.trim())) {
    res.status(400).json({ error: "Vui lòng nhập tên món đồ cần mua!" });
    return;
  }
  try {
    const item = FamilyDB.saveShoppingItem(req.body, session.userId, session.username);
    broadcastSyncEvent("SHOPPING_UPDATE", { itemId: item.id });
    res.json({ item });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/shopping/:id/toggle", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const item = FamilyDB.toggleShoppingItem(req.params.id, session.userId);
    broadcastSyncEvent("SHOPPING_UPDATE", { itemId: item.id });
    res.json({ item });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Note: this must be declared before the "/:id" route so "purchased" isn't treated as an id.
app.delete("/api/shopping/purchased", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const removed = FamilyDB.clearPurchasedShopping(session.userId, session.username);
  broadcastSyncEvent("SHOPPING_UPDATE");
  res.json({ removed });
});

app.delete("/api/shopping/all", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const removed = FamilyDB.clearAllShopping(session.userId, session.username);
  broadcastSyncEvent("SHOPPING_UPDATE");
  res.json({ removed });
});

app.delete("/api/shopping/:id", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    FamilyDB.deleteShoppingItem(req.params.id, session.userId, session.username);
    broadcastSyncEvent("SHOPPING_UPDATE", { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- USER MANAGEMENT ENDPOINTS ---

app.get("/api/users", requireAuth, (req: AuthRequest, res: Response) => {
  const users = FamilyDB.getUsers().map(u => {
    const { passwordHash, ...safe } = u;
    return safe;
  });
  res.json({ users });
});

app.post("/api/users", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { username, fullName, role, passwordPlain, avatarColor, dateOfBirth, gender, phone, familyRelation } = req.body;

  if (!username || !fullName || !role || !passwordPlain) {
    res.status(400).json({ error: "Vui lòng nhập đầy đủ chi tiết thành viên mới!" });
    return;
  }
  if (!VALID_ROLES.has(role)) {
    res.status(400).json({ error: "Vai trò (phân quyền) không hợp lệ!" });
    return;
  }

  try {
    const newUser = FamilyDB.createUser({
      username,
      fullName,
      role,
      passwordPlain,
      avatarColor,
      dateOfBirth,
      gender,
      phone,
      familyRelation
    }, session.userId, session.username);

    broadcastSyncEvent("USERS_UPDATE");
    res.json({ user: newUser });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Self-service profile update: a user can edit their OWN personal info only.
app.post("/api/profile", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { fullName, dateOfBirth, gender, phone, avatarImage, avatarColor } = req.body;

  try {
    validateAvatarImagePayload(avatarImage);
    const updated = FamilyDB.updateProfile(session.userId, {
      fullName,
      dateOfBirth,
      gender,
      phone,
      avatarImage,
      avatarColor
    });
    broadcastSyncEvent("USERS_UPDATE", { updatedId: session.userId });
    res.json({ user: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/users/:id", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;

  try {
    FamilyDB.deleteUser(id, session.userId, session.username);
    broadcastSyncEvent("USERS_UPDATE", { deletedId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/users/:id", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  const { fullName, role, dateOfBirth, gender, phone, avatarColor, familyRelation } = req.body;

  if (role !== undefined && !VALID_ROLES.has(role)) {
    res.status(400).json({ error: "Vai trò (phân quyền) không hợp lệ!" });
    return;
  }

  try {
    const updated = FamilyDB.adminUpdateUser(id, { fullName, role, dateOfBirth, gender, phone, avatarColor, familyRelation }, session.userId, session.username);
    broadcastSyncEvent("USERS_UPDATE", { updatedId: id });
    res.json({ user: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/users/:id/reset-password", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    res.status(400).json({ error: "Vui lòng nhập mật khẩu mới!" });
    return;
  }

  try {
    FamilyDB.adminResetPassword(id, newPassword, session.userId, session.username);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- NOTIFICATIONS ENDPOINTS ---

app.get("/api/notifications", requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.userSession!.userId;
  const list = FamilyDB.getNotifications().filter(n => n.userId === "all" || n.userId === userId);
  res.json({ notifications: list });
});

app.post("/api/notifications/:id/read", requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.userSession!.userId;
  const { id } = req.params;
  FamilyDB.markNotificationRead(id, userId);
  res.json({ success: true });
});

app.post("/api/notifications/read-all", requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.userSession!.userId;
  FamilyDB.markAllNotificationsRead(userId);
  res.json({ success: true });
});

// Manual nudge: a member sends a notification (+ push) to one person or "all".
// Gentle anti-spam: at most 1 send per 3s per sender.
const NUDGE_COOLDOWN_MS = 3000;
const lastNudgeAt = new Map<string, number>();

app.post("/api/notifications/send", requireAuth, (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  if (session.role === UserRole.GUEST) {
    res.status(403).json({ error: "Tài khoản Khách không gửi được lời nhắc." });
    return;
  }
  const { toUserId, message } = req.body || {};
  const msg = typeof message === "string" ? message.trim() : "";
  if (!toUserId || typeof toUserId !== "string") {
    res.status(400).json({ error: "Vui lòng chọn người nhận." });
    return;
  }
  if (!msg) {
    res.status(400).json({ error: "Nội dung lời nhắc không được để trống." });
    return;
  }
  if (msg.length > 300) {
    res.status(400).json({ error: "Nội dung quá dài (tối đa 300 ký tự)." });
    return;
  }
  if (toUserId !== "all" && !FamilyDB.getUsers().some(u => u.id === toUserId)) {
    res.status(400).json({ error: "Không tìm thấy người nhận." });
    return;
  }
  const now = Date.now();
  if (now - (lastNudgeAt.get(session.userId) || 0) < NUDGE_COOLDOWN_MS) {
    res.status(429).json({ error: "Bạn gửi hơi nhanh, chờ vài giây rồi thử lại nhé." });
    return;
  }
  lastNudgeAt.set(session.userId, now);
  try {
    FamilyDB.sendManualNotification(session.fullName, session.userId, toUserId, msg);
    broadcastSyncEvent("NOTIFICATIONS_UPDATE");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gửi lời nhắc thất bại." });
  }
});

// --- WEB PUSH (system notifications + app-icon badge) ---

// Public: the client needs the VAPID public key to create a push subscription.
app.get("/api/push/vapid-public-key", (_req: Request, res: Response) => {
  res.json({ publicKey: getVapidPublicKey(), enabled: isPushConfigured() });
});

// Save (upsert) this device's push subscription for the logged-in user.
app.post("/api/push/subscribe", requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.userSession!.userId;
  const { subscription } = req.body || {};
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: "Dữ liệu đăng ký thông báo không hợp lệ." });
    return;
  }
  try {
    FamilyDB.addPushSubscription(userId, subscription, req.headers["user-agent"]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Lưu đăng ký thất bại." });
  }
});

// Forget this device's subscription (called when the user turns notifications off).
app.post("/api/push/unsubscribe", requireAuth, (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint === "string" && endpoint) {
    FamilyDB.removePushSubscriptionByEndpoint(endpoint);
  }
  res.json({ success: true });
});

// Send a one-off test notification to the current user's devices.
app.post("/api/push/test", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.userSession!.userId;
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Máy chủ chưa cấu hình thông báo đẩy (VAPID)." });
    return;
  }
  try {
    const sent = await sendTestPush(
      FamilyDB.getPushSubscriptions(),
      userId,
      (dead) => FamilyDB.removePushSubscriptionsByEndpoints(dead)
    );
    res.json({ sent });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gửi thông báo thử thất bại." });
  }
});

// --- LOGS & BACKUPS (ADMIN ONLY) ---

app.get("/api/admin/logs", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const logs = FamilyDB.getActivityLogs();
  res.json({ logs });
});

app.get("/api/admin/backups", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const backups = FamilyDB.getBackups();
  res.json({ backups });
});

app.post("/api/admin/backups", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const info = FamilyDB.createBackup("manual", session.userId, session.username);
    broadcastSyncEvent("BACKUPS_UPDATE");
    res.json({ success: true, ...info });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/backups/:id", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  try {
    FamilyDB.deleteBackup(id, session.userId, session.username);
    broadcastSyncEvent("BACKUPS_UPDATE");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/backups/:id/restore", requireAuth, requireRole([UserRole.ADMIN]), (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  const { id } = req.params;
  try {
    FamilyDB.restoreBackup(id, session.userId, session.username);
    broadcastSyncEvent("RESTORE_COMPLETED");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sao lưu TOÀN PHẦN: tải về 1 tệp .zip chứa 100% hệ thống (DB + uploads + cấu hình).
app.get("/api/admin/backups/full/export", requireAuth, requireRole([UserRole.ADMIN]), async (req: AuthRequest, res: Response) => {
  const session = req.userSession!;
  try {
    const filename = fullBackupFilename();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await streamFullBackup(res);
    FamilyDB.logActivity(session.userId, session.username, "Backup toàn phần", `Đã xuất tệp sao lưu toàn phần ${filename} (DB + toàn bộ tệp media + cấu hình).`);
  } catch (err: any) {
    console.error("Lỗi xuất backup toàn phần:", err);
    // Nếu headers đã gửi (đang stream dở) thì chỉ còn cách cắt kết nối.
    if (res.headersSent) res.destroy();
    else res.status(500).json({ error: err.message || "Không xuất được backup toàn phần" });
  }
});

// Khôi phục TOÀN PHẦN từ tệp .zip tải lên — thay thế hoàn toàn dữ liệu hiện tại.
app.post(
  "/api/admin/backups/full/import",
  requireAuth,
  requireRole([UserRole.ADMIN]),
  express.raw({ type: () => true, limit: "2gb" }),
  async (req: AuthRequest, res: Response) => {
    const session = req.userSession!;
    // Chặn mọi ghi khác trong lúc import (các bước await dài) — ghi song song
    // sẽ bị snapshot restore nuốt mất nên trả 503 cho tới khi xong.
    maintenanceMode = true;
    try {
      const result = await importFullBackup(req.body as Buffer, session.userId, session.username);
      broadcastSyncEvent("RESTORE_COMPLETED");
      res.json({ success: true, restoredFiles: result.restoredFiles });
    } catch (err: any) {
      console.error("Lỗi import backup toàn phần:", err);
      res.status(400).json({ error: err.message || "Không khôi phục được từ tệp backup" });
    } finally {
      maintenanceMode = false;
    }
  }
);

// --- DASHBOARD WIDGETS (weather / crypto / gold / fx) ---
// Server-side proxy with caching: avoids CORS, respects rate limits, and keeps
// serving the last known value if an upstream call fails.

// Toạ độ mặc định (TP. Hồ Chí Minh) khi client không gửi kèm địa phương.
const WEATHER_LAT = 10.7769;
const WEATHER_LON = 106.7009;
const WEATHER_CITY = "TP. Hồ Chí Minh";

const widgetCache: Record<string, { data: any; ts: number }> = {};

async function cachedFetch(key: string, ttlMs: number, fetcher: () => Promise<any>): Promise<any> {
  const entry = widgetCache[key];
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  try {
    const data = await fetcher();
    widgetCache[key] = { data, ts: Date.now() };
    return data;
  } catch (e) {
    console.error(`Widget '${key}' fetch lỗi:`, e);
    return entry ? entry.data : null; // serve stale data on error
  }
}

// Suy ra "nguy cơ giông bão" (ước lượng, KHÔNG phải đường đi bão chính thức) từ
// mã thời tiết dông + gió giật hiện tại/tối đa trong các ngày dự báo. Thang gió
// tham chiếu cấp bão VN: cấp 8 (bão) ≈ 62 km/h, cấp 10 ≈ 89 km/h.
// Chỉ trả về dữ liệu có cấu trúc (level/type + số), phần văn bản dịch qua i18n
// ở client (dashboard.weather.storm.*) để hỗ trợ đa ngôn ngữ.
function deriveStormRisk(current: any, daily: any): any {
  const codeNow = Number(current?.weather_code);
  const gustNow = Number(current?.wind_gusts_10m) || 0;
  const gustsMax: number[] = Array.isArray(daily?.wind_gusts_10m_max) ? daily.wind_gusts_10m_max.map(Number) : [];
  const rainProb: number[] = Array.isArray(daily?.precipitation_probability_max) ? daily.precipitation_probability_max.map(Number) : [];
  const peakGust = Math.max(gustNow, ...(gustsMax.length ? gustsMax : [0]));
  const peakRain = rainProb.length ? Math.max(...rainProb) : 0;
  const thunderNow = [95, 96, 99].includes(codeNow);
  const gust = Math.round(peakGust);
  const rain = Math.round(peakRain);

  if (peakGust >= 89) {
    return { level: "warning", type: "typhoon", gust, rain, thunderNow };
  }
  if (peakGust >= 62) {
    return { level: "watch", type: "wind", gust, rain, thunderNow };
  }
  if (thunderNow || (peakRain >= 80 && peakGust >= 45)) {
    return { level: "watch", type: "thunder", gust, rain, thunderNow };
  }
  return { level: "none", type: "none", gust, rain, thunderNow: false };
}

async function fetchWeather(lat: number, lon: number, city: string) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,wind_gusts_10m_max&timezone=Asia%2FHo_Chi_Minh&forecast_days=3`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
  const j: any = await r.json();
  return { city, current: j.current, daily: j.daily, stormRisk: deriveStormRisk(j.current, j.daily) };
}

// Khoảng cách Haversine (km) giữa hai toạ độ.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Động đất gần đây trong bán kính quanh địa phương (USGS, miễn phí, không cần key).
async function fetchQuakes(lat: number, lon: number) {
  const RADIUS_KM = 500;
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${RADIUS_KM}&starttime=${start}&minmagnitude=2.5&orderby=time&limit=5`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`quakes HTTP ${r.status}`);
  const j: any = await r.json();
  const events = (j.features || []).map((f: any) => {
    const [qlon, qlat] = f.geometry?.coordinates || [];
    return {
      mag: f.properties?.mag ?? null,
      place: f.properties?.place ?? "",
      time: f.properties?.time ?? null,
      distanceKm: (typeof qlat === "number" && typeof qlon === "number") ? Math.round(haversineKm(lat, lon, qlat, qlon)) : null
    };
  });
  return { radiusKm: RADIUS_KM, events };
}

async function fetchCrypto() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,vnd&include_24hr_change=true";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`crypto HTTP ${r.status}`);
  return await r.json();
}

async function fetchFx() {
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!r.ok) throw new Error(`fx HTTP ${r.status}`);
  const j: any = await r.json();
  return { usdVnd: j.rates?.VND ?? null, updated: j.time_last_update_utc ?? null };
}

const VANG_TODAY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json, text/plain, */*"
};

function marketNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickVangTodayQuote(payload: any, code: string): any | null {
  if (!payload || typeof payload !== "object") return null;

  if (payload.type === code || payload.type_code === code) return payload;

  if (payload.prices && typeof payload.prices === "object" && payload.prices[code]) {
    return { type: code, ...payload.prices[code] };
  }

  const list: any[] = Array.isArray(payload.data) ? payload.data : [];
  return list.find(it => it?.type === code || it?.type_code === code) ?? null;
}

async function fetchVangTodayQuote(code: string) {
  const r = await fetch(`https://www.vang.today/api/prices?type=${encodeURIComponent(code)}`, {
    headers: VANG_TODAY_HEADERS
  });
  if (!r.ok) throw new Error(`vang.today ${code} HTTP ${r.status}`);
  const payload: any = await r.json();
  return { payload, quote: pickVangTodayQuote(payload, code) };
}

async function fetchGold(usdVnd: number | null) {
  // Prefer Vietnam SJC price from vang.today (VND/tael, free, no key).
  try {
    const { payload, quote } = await fetchVangTodayQuote("SJL1L10");
    const sell = marketNumber(quote?.sell);
    if (sell && sell > 0) {
      const buy = marketNumber(quote?.buy);
      const changeSell = marketNumber(quote?.change_sell) ?? 0;
      const prevSell = sell - changeSell;
      const changePct = prevSell ? (changeSell / prevSell) * 100 : null;
      return {
        source: quote?.name ? `Vàng ${quote.name}` : "Vàng SJC",
        buy,
        sell,
        changePct,
        updated: quote?.update_time ?? payload.timestamp ?? payload.current_time ?? null
      };
    }
    throw new Error("vang.today SJL1L10 response missing sell price");
  } catch (e) {
    console.error("Gold vang.today SJC loi, dung XAUUSD:", e);
  }

  // Fallback to world gold from the same provider.
  const { payload, quote } = await fetchVangTodayQuote("XAUUSD");
  const usdPerOz = marketNumber(quote?.sell) || marketNumber(quote?.buy);
  if (!usdPerOz) throw new Error("vang.today XAUUSD response missing price");

  const change = marketNumber(quote?.change_sell) || marketNumber(quote?.change_buy) || 0;
  const prev = usdPerOz - change;
  const changePct = prev ? (change / prev) * 100 : null;
  let vndPerTael: number | null = null;
  if (usdVnd) {
    // Approximate VND per tael (1 tael = 37.5g, 1 troy oz = 31.1035g).
    vndPerTael = Math.round((usdPerOz / 31.1035) * 37.5 * usdVnd);
  }
  return {
    source: "Vàng thế giới (XAU, tham khảo)",
    usdPerOz,
    changePct,
    vndPerTael,
    updated: quote?.update_time ?? payload.timestamp ?? payload.current_time ?? null
  };
}

app.get("/api/widgets/overview", requireAuth, async (req: AuthRequest, res: Response) => {
  // Toạ độ do client gửi theo địa phương từng người; fallback về TP.HCM.
  const parseCoord = (v: any, min: number, max: number, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const lat = parseCoord(req.query.lat, 8, 24, WEATHER_LAT);   // giới hạn quanh VN
  const lon = parseCoord(req.query.lon, 102, 110, WEATHER_LON);
  const city = typeof req.query.city === "string" && req.query.city.trim() ? req.query.city.trim().slice(0, 60) : WEATHER_CITY;
  const geoKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;

  const weather = await cachedFetch(`weather_v2_${geoKey}`, 15 * 60 * 1000, () => fetchWeather(lat, lon, city));
  const quakes = await cachedFetch(`quakes_${geoKey}`, 30 * 60 * 1000, () => fetchQuakes(lat, lon));
  const cryptoPrices = await cachedFetch("crypto", 5 * 60 * 1000, fetchCrypto);
  const fx = await cachedFetch("fx", 30 * 60 * 1000, fetchFx);
  const gold = await cachedFetch("gold", 30 * 60 * 1000, () => fetchGold(fx?.usdVnd ?? null));
  res.json({ weather, quakes, crypto: cryptoPrices, fx, gold });
});

// --- LỊCH SỬ GIÁ THỊ TRƯỜNG (sparkline BTC/ETH/Vàng/USD ở Tổng quan) ---

// Chụp một điểm giá vào CSDL (dedupe/prune nằm trong FamilyDB.appendMarketHistory).
async function recordMarketSnapshot() {
  try {
    const fx = await cachedFetch("fx", 30 * 60 * 1000, fetchFx);
    const [cryptoPrices, gold] = await Promise.all([
      cachedFetch("crypto", 5 * 60 * 1000, fetchCrypto),
      cachedFetch("gold", 30 * 60 * 1000, () => fetchGold(fx?.usdVnd ?? null))
    ]);
    FamilyDB.appendMarketHistory({
      btcUsd: marketNumber(cryptoPrices?.bitcoin?.usd),
      ethUsd: marketNumber(cryptoPrices?.ethereum?.usd),
      goldSell: marketNumber(gold?.sell) ?? marketNumber(gold?.vndPerTael),
      usdVnd: marketNumber(fx?.usdVnd)
    });
  } catch (e) {
    console.error("Không ghi được lịch sử giá thị trường:", e);
  }
}

// Server chạy 24/7 trên Pi nên tự chụp ~10 phút/lần, không phụ thuộc ai mở app.
setTimeout(recordMarketSnapshot, 20 * 1000);
setInterval(recordMarketSnapshot, 10 * 60 * 1000);

// Trả lịch sử trong N ngày (mặc định 7, tối đa 30), downsample còn ≤200 điểm.
app.get("/api/widgets/history", requireAuth, (req: AuthRequest, res: Response) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const cutoff = Date.now() - days * 86400000;
  const all = FamilyDB.getMarketHistory().filter(p => new Date(p.at).getTime() >= cutoff);
  const MAX_POINTS = 200;
  const step = Math.ceil(all.length / MAX_POINTS);
  const points = step > 1 ? all.filter((_, i) => i % step === 0 || i === all.length - 1) : all;
  res.json({ days, points });
});

// --- VITE MIDDLEWARE SETUP & STATIC SERVING ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ["**/data/**"]
        }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const pwaAssets: Record<string, { file: string; type: string; cacheControl: string }> = {
      "/manifest.webmanifest": {
        file: "manifest.webmanifest",
        type: "application/manifest+json",
        cacheControl: "no-cache"
      },
      "/sw.js": {
        file: "sw.js",
        type: "application/javascript; charset=utf-8",
        cacheControl: "no-cache, no-store, must-revalidate"
      },
      "/pwa-icon.svg": {
        file: "pwa-icon.svg",
        type: "image/svg+xml; charset=utf-8",
        cacheControl: "public, max-age=86400"
      }
    };

    Object.entries(pwaAssets).forEach(([route, asset]) => {
      app.get(route, (_req, res) => {
        res.setHeader("Content-Type", asset.type);
        res.setHeader("Cache-Control", asset.cacheControl);
        res.sendFile(path.join(distPath, asset.file), err => {
          if (err && !res.headersSent) {
            res.status(404).send(`${asset.file} not found. Rebuild the Docker image with the public/ directory included.`);
          }
        });
      });
    });

    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Generate birthday + deadline reminders once at boot
  try {
    FamilyDB.generateBirthdayNotifications();
    FamilyDB.generateReminders();
  } catch (e) {
    console.error("Lỗi tạo nhắc nhở lúc khởi động:", e);
  }

  // Check deadline/event reminders every 30 minutes (fine-grained for the 1-hour window)
  setInterval(() => {
    try {
      FamilyDB.generateReminders();
      broadcastSyncEvent("NOTIFICATIONS_UPDATE");
    } catch (e) {
      console.error("Lỗi tạo nhắc deadline định kỳ:", e);
    }
  }, 30 * 60 * 1000);

  // Backup on startup if the most recent auto backup is missing or stale (>20h).
  // Guards against never backing up when the server restarts more often than every 24h.
  try {
    const lastAuto = FamilyDB.getBackups().find(b => b.type === "auto");
    const staleMs = 20 * 60 * 60 * 1000;
    if (!lastAuto || Date.now() - new Date(lastAuto.createdAt).getTime() > staleMs) {
      console.log("Tạo backup tự động lúc khởi động...");
      FamilyDB.createBackup("auto", "system", "Hệ thống");
    }
  } catch (e) {
    console.error("Lỗi backup khi khởi động:", e);
  }

  // Periodic automatic daily backup + birthday reminder refresh
  setInterval(() => {
    try {
      console.log("Đang chạy backup dữ liệu tự động định kỳ...");
      FamilyDB.createBackup("auto", "system", "Hệ thống");
    } catch (e) {
      console.error("Lỗi tự động sao lưu dữ liệu:", e);
    }
    try {
      FamilyDB.generateBirthdayNotifications();
    } catch (e) {
      console.error("Lỗi tạo nhắc sinh nhật định kỳ:", e);
    }
  }, 1000 * 60 * 60 * 24); // Every 24 hours

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
