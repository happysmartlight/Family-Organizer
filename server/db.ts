/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  FamilyOrganizerDB,
  User,
  UserRole,
  FamilyRelation,
  Task,
  FamilyPlan,
  Note,
  FinancialTransaction,
  RewardPointEntry,
  RewardItem,
  BudgetLimit,
  CustomExpenseCategory,
  RecurringBill,
  FamilyAsset,
  MedicationReminder,
  MedicationLog,
  FamilyDocument,
  DOCUMENT_TYPE_LABELS,
  SavingsGoal,
  SavingsContribution,
  Debt,
  DebtPayment,
  VaccinationRecord,
  GrowthRecord,
  EmergencyProfile,
  ShoppingItem,
  Notification,
  PushSubscriptionRecord,
  StoredDish,
  StoredMealPlan,
  MarketHistoryPoint,
  MealIngredient,
  DishSlot
} from "../src/types.js";
import { SEED_DISHES } from "../src/utils/mealPlan.js";
import { isDebtFullyPaid } from "../src/utils/debt.js";
import { sqliteIsEmpty, sqliteLoad, sqliteSave, sqliteCheckpoint } from "./sqlite.js";
import { deleteMediaByUrl } from "./media.js";
import { dispatchPush } from "./push.js";

// Whitelist of valid asset types (mirrors AssetType in src/types.ts).
const VALID_ASSET_TYPES = new Set<string>([
  "crypto", "land", "gold_bar", "gold_ring", "gold_jewelry", "gold_other", "vehicle", "stock", "other"
]);

// Whitelist of valid document types (mirrors DocumentType in src/types.ts).
const VALID_DOCUMENT_TYPES = new Set<string>([
  "cccd", "passport", "driver_license", "vehicle_registration", "vehicle_inspection",
  "insurance", "health_insurance", "warranty", "contract", "certificate", "other"
]);

// Collect the stored image URLs referenced by an asset's photos.
function assetPhotoUrls(asset: { photos?: any[] } | undefined | null): string[] {
  if (!asset || !Array.isArray(asset.photos)) return [];
  const urls: string[] = [];
  asset.photos.forEach(p => {
    if (p?.fullDataUrl) urls.push(p.fullDataUrl);
    if (p?.thumbnailDataUrl) urls.push(p.thumbnailDataUrl);
  });
  return urls;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const SECRET_FILE = path.join(DATA_DIR, "session_secret.key");
// App-level config the admin can edit from the UI (e.g. Gemini API key).
// Kept in its own file — NOT in db.json — so it never ends up in data backups.
const SETTINGS_FILE = path.join(DATA_DIR, "app_settings.json");

// Legacy salt kept only to verify passwords hashed by the old scheme.
const LEGACY_SALT = "family_organizer_salt_2026";
const PBKDF2_ITERATIONS = 120000;

// Keep only the most recent N automatic backups (manual backups are kept indefinitely).
const MAX_AUTO_BACKUPS = 7;

// Password hashing: per-user random salt, stored as "salt$hash".
export function hashPassword(password: string, salt?: string): string {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, useSalt, PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
  return `${useSalt}$${hash}`;
}

// Verify a plaintext password against a stored hash (supports legacy format).
export function verifyPassword(password: string, stored: string): boolean {
  if (stored && stored.includes("$")) {
    const sepIndex = stored.indexOf("$");
    const salt = stored.slice(0, sepIndex);
    const hash = stored.slice(sepIndex + 1);
    const computed = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
    if (computed.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  }
  // Legacy fallback: old global-salt, 1000-iteration scheme.
  const legacy = crypto.pbkdf2Sync(password, LEGACY_SALT, 1000, 64, "sha512").toString("hex");
  return legacy === stored;
}

// Stable per-install secret used to sign session tokens. Generated once.
export function getSessionSecret(): string {
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (existing) return existing;
    }
  } catch (e) {
    console.error("Không đọc được session secret:", e);
  }
  const secret = crypto.randomBytes(48).toString("hex");
  try {
    fs.writeFileSync(SECRET_FILE, secret, "utf8");
  } catch (e) {
    console.error("Không ghi được session secret:", e);
  }
  return secret;
}

// --- App settings (admin-editable, stored outside the DB & backups) ---
export function getAppSettings(): Record<string, string> {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) || {};
    }
  } catch (e) {
    console.error("Không đọc được app_settings.json:", e);
  }
  return {};
}

export function setAppSetting(key: string, value: string | null): void {
  const settings = getAppSettings();
  if (value === null || value === "") delete settings[key];
  else settings[key] = value;
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    console.error("Không ghi được app_settings.json:", e);
  }
}

// Thay TOÀN BỘ app settings (dùng khi khôi phục từ backup toàn phần — ghi đè, không merge).
export function replaceAppSettings(settings: Record<string, string>): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings || {}, null, 2), "utf8");
  } catch (e) {
    console.error("Không ghi được app_settings.json:", e);
  }
}

// Initial seed data — a blank database with only a single admin account.
// All demo members and sample content (tasks/plans/notes/transactions) were removed.
// At least one admin is required because the app has no public sign-up; the
// admin creates real members afterwards from the Settings screen.
const initialDBState = (): FamilyOrganizerDB => {
  const users = [
    {
      id: "user_admin",
      username: "admin",
      fullName: "Gia Trưởng (Admin)",
      role: UserRole.ADMIN,
      avatarColor: "bg-red-500",
      passwordHash: hashPassword("admin123"),
      createdAt: new Date().toISOString()
    }
  ];

  return {
    users,
    tasks: [],
    plans: [],
    notes: [],
    transactions: [],
    rewardLedger: [],
    rewardItems: [],
    budgets: [],
    customCategories: [],
    hiddenBuiltinCategories: [],
    recurringBills: [],
    savingsGoals: [],
    debts: [],
    assets: [],
    medications: [],
    medicationLogs: [],
    vaccinations: [],
    growthRecords: [],
    healthProfiles: [],
    documents: [],
    shoppingItems: [],
    dishLibrary: [],
    mealPlan: null,
    marketHistory: [],
    notifications: [],
    pushSubscriptions: [],
    activityLogs: [],
    backups: []
  };
};

// Ensure all collections exist even when loading an older db.json that predates a field.
function normalizeDB(db: any): FamilyOrganizerDB {
  db.users = db.users || [];
  db.tasks = db.tasks || [];
  db.plans = db.plans || [];
  db.notes = db.notes || [];
  db.transactions = db.transactions || [];
  db.rewardLedger = db.rewardLedger || [];
  db.rewardItems = db.rewardItems || [];
  db.budgets = db.budgets || [];
  db.customCategories = db.customCategories || [];
  db.hiddenBuiltinCategories = Array.isArray(db.hiddenBuiltinCategories) ? db.hiddenBuiltinCategories : [];
  db.recurringBills = db.recurringBills || [];
  db.savingsGoals = db.savingsGoals || [];
  db.debts = db.debts || [];
  db.assets = db.assets || [];
  db.medications = db.medications || [];
  db.medicationLogs = db.medicationLogs || [];
  db.vaccinations = db.vaccinations || [];
  db.growthRecords = db.growthRecords || [];
  db.healthProfiles = db.healthProfiles || [];
  db.documents = db.documents || [];
  db.shoppingItems = db.shoppingItems || [];
  db.dishLibrary = db.dishLibrary || [];
  db.mealPlan = db.mealPlan || null;
  db.marketHistory = db.marketHistory || [];
  db.notifications = db.notifications || [];
  db.pushSubscriptions = db.pushSubscriptions || [];
  db.activityLogs = db.activityLogs || [];
  db.backups = db.backups || [];
  db.tasks = db.tasks.map((task: any) => ({
    ...task,
    rewardPoints: Number(task.rewardPoints || 0),
    completedById: task.completedById ?? null,
    completedAt: task.completedAt ?? null,
    recurrenceType: task.recurrenceType || "none",
    recurrenceInterval: Number(task.recurrenceInterval || 1),
    sourceRecurringTaskId: task.sourceRecurringTaskId ?? null
  }));
  db.plans = db.plans.map((plan: any) => ({
    ...plan,
    recurrenceWeekdays: Array.isArray(plan.recurrenceWeekdays)
      ? plan.recurrenceWeekdays.map((d: any) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
      : undefined
  }));
  return db as FamilyOrganizerDB;
}

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// One-time storage bootstrap: if SQLite is empty, import the existing db.json
// (preserving ids so sessions/frontend keep working), otherwise seed a blank DB.
// The original db.json is left untouched as a pre-migration rollback snapshot.
(function bootstrapStorage() {
  try {
    if (!sqliteIsEmpty()) return;
    let seed: FamilyOrganizerDB;
    if (fs.existsSync(DB_FILE)) {
      try {
        seed = normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
        console.log("Đã nhập dữ liệu từ db.json sang SQLite (family.db).");
      } catch (e) {
        console.error("db.json hỏng, khởi tạo CSDL trắng:", e);
        seed = initialDBState();
      }
    } else {
      seed = initialDBState();
    }
    sqliteSave(seed);
  } catch (e) {
    console.error("Lỗi bootstrap SQLite:", e);
  }
})();

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function formatLocalDateTime(date: Date, withTime = true): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (!withTime) return `${yyyy}-${mm}-${dd}`;
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function advanceDateString(value: string, recurrenceType: string, interval = 1, withTime = true): string | null {
  const d = parseLocalDateTime(value);
  if (!d || recurrenceType === "none") return null;
  const step = Math.max(1, Number(interval || 1));
  if (recurrenceType === "daily") d.setDate(d.getDate() + step);
  if (recurrenceType === "weekly") d.setDate(d.getDate() + step * 7);
  if (recurrenceType === "monthly") d.setMonth(d.getMonth() + step);
  if (recurrenceType === "yearly") d.setFullYear(d.getFullYear() + step);
  return formatLocalDateTime(d, withTime);
}

// Core DB operations helper
export class FamilyDB {
  private static readRaw(): FamilyOrganizerDB {
    return normalizeDB(sqliteLoad());
  }

  private static writeRaw(db: FamilyOrganizerDB): void {
    // better-sqlite3 is synchronous; the save runs in a single atomic WAL transaction.
    try {
      sqliteSave(db);
    } catch (e) {
      console.error("Lỗi ghi dữ liệu vào SQLite:", e);
    }
  }

  // Activity logs helper
  public static logActivity(userId: string, username: string, action: string, details: string) {
    const db = this.readRaw();
    db.activityLogs.unshift({
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userId,
      username,
      action,
      details,
      createdAt: new Date().toISOString()
    });
    // Cap logs at 300 to keep it lightweight on Raspberry Pi 5
    if (db.activityLogs.length > 300) {
      db.activityLogs = db.activityLogs.slice(0, 300);
    }
    this.writeRaw(db);
  }

  // Backup management
  public static createBackup(type: "auto" | "manual", userId: string, username: string): { filename: string; sizeKb: number } {
    const db = this.readRaw();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${type}_${timestamp}.json`;
    const destPath = path.join(BACKUP_DIR, filename);

    try {
      // Snapshot the live SQLite data to a JSON file (human-readable, restore-friendly).
      sqliteCheckpoint();
      fs.writeFileSync(destPath, JSON.stringify(db, null, 2), "utf8");

      const stats = fs.statSync(destPath);
      const sizeKb = Math.ceil(stats.size / 1024);

      // Save backup reference in memory
      db.backups.unshift({
        id: `backup_${Date.now()}`,
        filename,
        createdAt: new Date().toISOString(),
        sizeKb,
        type
      });

      // Retention: keep only the most recent auto backups; remove old files + metadata.
      // db.backups is newest-first (unshift), so the filtered list is also newest-first.
      const autoBackups = db.backups.filter(b => b.type === "auto");
      if (autoBackups.length > MAX_AUTO_BACKUPS) {
        const toRemove = autoBackups.slice(MAX_AUTO_BACKUPS);
        for (const old of toRemove) {
          try {
            const oldPath = path.join(BACKUP_DIR, old.filename);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch (e) {
            console.error("Không xóa được tệp backup cũ:", old.filename, e);
          }
        }
        const removeIds = new Set(toRemove.map(b => b.id));
        db.backups = db.backups.filter(b => !removeIds.has(b.id));
      }

      this.writeRaw(db);
      this.logActivity(userId, username, "Backup dữ liệu", `Đã tạo tệp sao lưu ${filename} thành công (${sizeKb} KB).`);
      return { filename, sizeKb };
    } catch (err) {
      console.error("Không thể tạo backup tệp:", err);
      throw new Error(`Sao lưu dữ liệu thất bại: ${err}`);
    }
  }

  public static deleteBackup(backupId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const backupIndex = db.backups.findIndex(b => b.id === backupId);
    if (backupIndex === -1) return;

    const backup = db.backups[backupIndex];
    const filepath = path.join(BACKUP_DIR, backup.filename);

    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      db.backups.splice(backupIndex, 1);
      this.writeRaw(db);
      this.logActivity(userId, username, "Xử lý Backup", `Đã xóa tệp sao lưu ${backup.filename}.`);
    } catch (err) {
      console.error("Lỗi xóa file backup:", err);
      throw err;
    }
  }

  // Snapshot đầy đủ của DB (đã checkpoint WAL) — dùng cho backup toàn phần.
  public static getFullSnapshot(): FamilyOrganizerDB {
    sqliteCheckpoint();
    return this.readRaw();
  }

  // Đối soát danh sách backup trong DB với các file thật trong data/backups:
  // bỏ mục thiếu file, nhận nuôi file mồ côi (vd: backup an toàn tạo ngay trước khi import).
  private static reconcileBackupsWithDisk(db: FamilyOrganizerDB): void {
    try {
      const onDisk = new Set(
        fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("backup_") && f.endsWith(".json"))
      );
      db.backups = (db.backups || []).filter(b => onDisk.has(b.filename));
      const listed = new Set(db.backups.map(b => b.filename));
      for (const filename of onDisk) {
        if (listed.has(filename)) continue;
        const stats = fs.statSync(path.join(BACKUP_DIR, filename));
        db.backups.push({
          id: `backup_${stats.mtimeMs}_${Math.random().toString(36).slice(2, 7)}`,
          filename,
          createdAt: stats.mtime.toISOString(),
          sizeKb: Math.ceil(stats.size / 1024),
          type: filename.includes("_auto_") ? "auto" : "manual"
        });
      }
      db.backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      console.error("Không đối soát được danh sách backup với đĩa:", e);
    }
  }

  // Nạp một snapshot DB (đã parse từ tệp backup) vào SQLite — dùng cho import toàn phần.
  public static restoreFromSnapshot(parsedData: any, userId: string, username: string, sourceLabel: string): void {
    if (!parsedData || !parsedData.users || !parsedData.tasks) {
      throw new Error("Dữ liệu backup không hợp lệ hoặc thiếu thông tin cốt lõi (users/tasks)!");
    }
    const restored = normalizeDB(parsedData);
    this.reconcileBackupsWithDisk(restored);
    sqliteSave(restored);
    this.logActivity(userId, username, "Phục hồi toàn phần", `Đã khôi phục toàn bộ hệ thống từ ${sourceLabel}.`);
  }

  public static restoreBackup(backupId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const backup = db.backups.find(b => b.id === backupId);
    if (!backup) throw new Error("Không tìm thấy tệp sao lưu này!");

    const filepath = path.join(BACKUP_DIR, backup.filename);
    if (!fs.existsSync(filepath)) throw new Error("Tệp sao lưu vật lý không tồn tại trên đĩa!");

    try {
      // Read backed up file content
      const fileData = fs.readFileSync(filepath, "utf8");
      const parsedData = JSON.parse(fileData);

      // Validate integrity at least check users & tasks
      if (!parsedData.users || !parsedData.tasks) {
        throw new Error("Tệp sao lưu không hợp lệ hoặc thiếu thông tin cốt lõi!");
      }

      // Load the snapshot back into SQLite (atomic replace)
      sqliteSave(normalizeDB(parsedData));

      // Re-log the activity to the newly loaded db!
      this.logActivity(userId, username, "Phục hồi hệ thống", `Đã phục hồi dữ liệu về điểm sao lưu: ${backup.filename}.`);
    } catch (err) {
      console.error("Lỗi phục hồi dữ liệu:", err);
      throw err;
    }
  }

  // Generic Getters
  public static getUsers() {
    return this.readRaw().users;
  }

  public static getTasks() {
    return this.readRaw().tasks;
  }

  public static getPlans() {
    return this.readRaw().plans;
  }

  public static getNotes() {
    return this.readRaw().notes;
  }

  public static getTransactions() {
    return this.readRaw().transactions;
  }

  public static getRewardLedger() {
    return this.readRaw().rewardLedger;
  }

  public static getBudgets() {
    return this.readRaw().budgets;
  }

  public static getRecurringBills() {
    return this.readRaw().recurringBills;
  }

  public static getAssets() {
    return this.readRaw().assets;
  }

  public static getMedications() {
    return this.readRaw().medications;
  }

  public static getNotifications() {
    return this.readRaw().notifications;
  }

  public static getActivityLogs() {
    return this.readRaw().activityLogs;
  }

  public static getBackups() {
    return this.readRaw().backups;
  }

  // MUTATIONS (each returns the modified db items or a success state)
  
  // Create User (Admin Only)
  public static createUser(u: { username: string; fullName: string; role: UserRole; passwordPlain: string; avatarColor: string; dateOfBirth?: string; gender?: "male" | "female"; phone?: string; familyRelation?: FamilyRelation }, adminId: string, adminUser: string): User {
    const db = this.readRaw();
    if (db.users.some(existing => existing.username === u.username.toLowerCase())) {
      throw new Error("Tài khoản này đã tồn tại trong gia đình!");
    }

    const newUser = {
      id: `user_${Date.now()}`,
      username: u.username.toLowerCase().trim(),
      fullName: u.fullName.trim(),
      role: u.role,
      familyRelation: u.familyRelation || undefined,
      avatarColor: u.avatarColor || "bg-indigo-500",
      dateOfBirth: u.dateOfBirth || undefined,
      gender: u.gender === "male" || u.gender === "female" ? u.gender : undefined,
      phone: u.phone ? u.phone.trim() : undefined,
      passwordHash: hashPassword(u.passwordPlain),
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    this.writeRaw(db);
    this.logActivity(adminId, adminUser, "Thêm thành viên", `Đã thêm thành viên mới: ${newUser.fullName} (${newUser.role}).`);

    // Return safe user without secret passwordHash
    const { passwordHash, ...safeUser } = newUser;
    return safeUser;
  }

  // Update own profile (self-service personalization)
  public static updateProfile(userId: string, data: { fullName?: string; dateOfBirth?: string; gender?: "male" | "female" | ""; phone?: string; avatarImage?: string; avatarColor?: string }): User {
    const db = this.readRaw();
    const idx = db.users.findIndex(u => u.id === userId);
    if (idx === -1) {
      throw new Error("Không tìm thấy tài khoản người dùng!");
    }

    const user = db.users[idx];

    if (data.fullName !== undefined) {
      const trimmed = data.fullName.trim();
      if (!trimmed) throw new Error("Tên hiển thị không được để trống!");
      user.fullName = trimmed;
    }
    if (data.dateOfBirth !== undefined) {
      user.dateOfBirth = data.dateOfBirth || undefined;
    }
    if (data.gender !== undefined) {
      user.gender = data.gender === "male" || data.gender === "female" ? data.gender : undefined;
    }
    if (data.phone !== undefined) {
      user.phone = data.phone.trim() || undefined;
    }
    if (data.avatarColor !== undefined && data.avatarColor) {
      user.avatarColor = data.avatarColor;
    }
    if (data.avatarImage !== undefined) {
      // Empty string clears the custom image and falls back to the color avatar.
      // Delete the previous file if it was a stored upload and is being replaced.
      const next = data.avatarImage || undefined;
      if (user.avatarImage && user.avatarImage !== next) deleteMediaByUrl(user.avatarImage);
      user.avatarImage = next;
    }

    db.users[idx] = user;
    this.writeRaw(db);
    this.logActivity(userId, user.username, "Cập nhật hồ sơ", `Đã cập nhật thông tin cá nhân của ${user.fullName}.`);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  // Generate in-app notifications for birthdays happening within the next 7 days.
  // Deduplicated per user per year so it is safe to call repeatedly.
  public static generateBirthdayNotifications(): void {
    const db = this.readRaw();
    const today = new Date();
    const year = today.getFullYear();
    const todayMidnight = new Date(year, today.getMonth(), today.getDate()).getTime();
    let modified = false;

    db.users.forEach(u => {
      if (!u.dateOfBirth) return;
      const dob = new Date(u.dateOfBirth);
      if (isNaN(dob.getTime())) return;

      // Lần sinh nhật sắp tới: nếu năm nay đã qua thì tính sang năm sau → bao luôn ca cuối/đầu năm.
      let bdayDate = new Date(year, dob.getMonth(), dob.getDate());
      if (bdayDate.getTime() < todayMidnight) {
        bdayDate = new Date(year + 1, dob.getMonth(), dob.getDate());
      }
      const diffDays = Math.round((bdayDate.getTime() - todayMidnight) / 86400000);
      if (diffDays > 7) return;

      const occYear = bdayDate.getFullYear();
      const notifId = `notif_bday_${u.id}_${occYear}`;
      if (db.notifications.some(n => n.id === notifId)) return;

      const age = occYear - dob.getFullYear();
      const when = diffDays === 0 ? "hôm nay 🎉" : `trong ${diffDays} ngày nữa`;
      const bdayNotif: Notification = {
        id: notifId,
        userId: "all",
        title: "🎂 Sắp đến sinh nhật!",
        content: `${u.fullName} sẽ tròn ${age} tuổi ${when} (ngày ${dob.getDate()}/${dob.getMonth() + 1}). Cả nhà chuẩn bị chúc mừng nhé!`,
        type: "system",
        isRead: false,
        createdAt: new Date().toISOString()
      };
      db.notifications.unshift(bdayNotif);
      void dispatchPush(db, bdayNotif, (dead) => this.removePushSubscriptionsByEndpoints(dead));
      modified = true;
    });

    if (db.notifications.length > 200) {
      db.notifications = db.notifications.slice(0, 200);
    }
    if (modified) this.writeRaw(db);
  }

  // Delete User (Admin Only)
  public static deleteUser(userId: string, adminId: string, adminUser: string): void {
    const db = this.readRaw();
    const target = db.users.find(u => u.id === userId);
    if (!target) {
      throw new Error("Không tìm thấy thành viên này trong gia đình!");
    }
    if (userId === adminId) {
      throw new Error("Bạn không thể tự xóa tài khoản của chính mình!");
    }
    // Never allow removing the very last admin, or the system becomes unmanageable
    if (target.role === UserRole.ADMIN) {
      const adminCount = db.users.filter(u => u.role === UserRole.ADMIN).length;
      if (adminCount <= 1) {
        throw new Error("Không thể xóa Quản trị viên (Admin) cuối cùng của hệ thống!");
      }
    }

    // Soft delete: keep the record so historical name/avatar lookups still work.
    // Clear password so the account cannot be used to log in.
    const idx = db.users.findIndex(u => u.id === userId);
    const avatarToDelete = db.users[idx].avatarImage;
    db.users[idx].isDeleted = true;
    db.users[idx].passwordHash = "";
    db.users[idx].avatarImage = undefined;
    this.writeRaw(db);
    if (avatarToDelete) deleteMediaByUrl(avatarToDelete);
    this.logActivity(adminId, adminUser, "Xóa thành viên", `Đã xóa tài khoản ${target.fullName} (@${target.username}).`);
  }

  // Change own password (requires current password)
  public static changePassword(userId: string, currentPassword: string, newPassword: string): void {
    const db = this.readRaw();
    const idx = db.users.findIndex(u => u.id === userId);
    if (idx === -1) throw new Error("Không tìm thấy tài khoản!");
    if (!verifyPassword(currentPassword, db.users[idx].passwordHash)) {
      throw new Error("Mật khẩu hiện tại không chính xác!");
    }
    if (!newPassword || newPassword.length < 4) {
      throw new Error("Mật khẩu mới phải có ít nhất 4 ký tự!");
    }
    db.users[idx].passwordHash = hashPassword(newPassword);
    this.writeRaw(db);
    this.logActivity(userId, db.users[idx].username, "Đổi mật khẩu", "Đã đổi mật khẩu đăng nhập của mình.");
  }

  // Admin updates another member's profile + role
  public static adminUpdateUser(
    targetId: string,
    data: { fullName?: string; role?: UserRole; dateOfBirth?: string; gender?: "male" | "female" | ""; phone?: string; avatarColor?: string; familyRelation?: FamilyRelation },
    adminId: string,
    adminUser: string
  ): User {
    const db = this.readRaw();
    const idx = db.users.findIndex(u => u.id === targetId);
    if (idx === -1) throw new Error("Không tìm thấy thành viên!");
    const user = db.users[idx];

    // Never demote the very last admin (would lock everyone out of management)
    if (data.role !== undefined && data.role !== UserRole.ADMIN && user.role === UserRole.ADMIN) {
      const adminCount = db.users.filter(u => u.role === UserRole.ADMIN).length;
      if (adminCount <= 1) {
        throw new Error("Không thể đổi vai trò của Quản trị viên (Admin) cuối cùng!");
      }
    }

    if (data.fullName !== undefined) {
      const trimmed = data.fullName.trim();
      if (!trimmed) throw new Error("Tên hiển thị không được để trống!");
      user.fullName = trimmed;
    }
    if (data.role !== undefined) user.role = data.role;
    if (data.familyRelation !== undefined) user.familyRelation = data.familyRelation || undefined;
    if (data.dateOfBirth !== undefined) user.dateOfBirth = data.dateOfBirth || undefined;
    if (data.gender !== undefined) user.gender = data.gender === "male" || data.gender === "female" ? data.gender : undefined;
    if (data.phone !== undefined) user.phone = data.phone.trim() || undefined;
    if (data.avatarColor !== undefined && data.avatarColor) user.avatarColor = data.avatarColor;

    db.users[idx] = user;
    this.writeRaw(db);
    this.logActivity(adminId, adminUser, "Cập nhật thành viên", `Đã cập nhật ${user.fullName} (@${user.username}) — vai trò: ${user.role}.`);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  // Admin resets another member's password (no current password needed)
  public static adminResetPassword(targetId: string, newPassword: string, adminId: string, adminUser: string): void {
    const db = this.readRaw();
    const idx = db.users.findIndex(u => u.id === targetId);
    if (idx === -1) throw new Error("Không tìm thấy thành viên!");
    if (!newPassword || newPassword.length < 4) {
      throw new Error("Mật khẩu mới phải có ít nhất 4 ký tự!");
    }
    db.users[idx].passwordHash = hashPassword(newPassword);
    this.writeRaw(db);
    this.logActivity(adminId, adminUser, "Đặt lại mật khẩu", `Đã đặt lại mật khẩu cho ${db.users[idx].fullName} (@${db.users[idx].username}).`);
  }

  // Tasks Management
  public static saveTask(taskData: Partial<Task>, userId: string, username: string): Task {
    const db = this.readRaw();
    const nowStr = new Date().toISOString();

    if (taskData.id) {
      // UPDATE Task
      const idx = db.tasks.findIndex(t => t.id === taskData.id);
      if (idx === -1) throw new Error("Task không tồn tại");

      const oldTask = db.tasks[idx];
      const isCompleting = taskData.status === "completed" && oldTask.status !== "completed";

      // Gating duyệt: trẻ (CHILD) tự báo hoàn thành một task có điểm > ngưỡng tự duyệt
      // của gia đình → task vào trạng thái "chờ ba mẹ duyệt" thay vì cộng điểm ngay.
      // Người lớn tự hoàn thành, hoặc điểm ≤ ngưỡng → hoàn thành + cộng điểm luôn.
      const actorRole = db.users.find(u => u.id === userId)?.role;
      // Ai sẽ nhận điểm: người được giao, nếu không có thì chính người bấm hoàn thành
      // (khớp đúng logic cộng điểm bên dưới) — nên cổng duyệt cũng xét theo người này.
      const rewardRecipientId = (taskData.assigneeId ?? oldTask.assigneeId) || userId;
      const recipientRole = db.users.find(u => u.id === rewardRecipientId)?.role;
      const rewardPts = Math.max(0, Number((taskData as any).rewardPoints ?? oldTask.rewardPoints ?? 0));
      const approvalThreshold = Math.max(0, Number(getAppSettings().rewardApprovalThreshold || 0));
      const needsApproval = isCompleting
        && rewardPts > 0
        && actorRole === UserRole.CHILD
        && recipientRole === UserRole.CHILD
        && rewardPts > approvalThreshold;
      const effectiveCompleting = isCompleting && !needsApproval;

      // Determine history changes
      const changelog: string[] = [];
      if (taskData.status && taskData.status !== oldTask.status) {
        changelog.push(`trạng thái từ '${oldTask.status}' thành '${taskData.status}'`);
      }
      if (taskData.assigneeId !== undefined && taskData.assigneeId !== oldTask.assigneeId) {
        const uStore = db.users.find(u => u.id === taskData.assigneeId);
        changelog.push(`giao việc cho ${uStore ? uStore.fullName : "Chưa phân công"}`);
      }

      const updatedHistory = [...(oldTask.history || [])];
      if (changelog.length > 0) {
        updatedHistory.unshift({
          id: `h_${Date.now()}`,
          userId,
          username,
          action: `Đã thay đổi: ${changelog.join(", ")}`,
          createdAt: nowStr
        });
      }

      const nextRecurrenceType = (taskData as any).recurrenceType ?? oldTask.recurrenceType ?? "none";
      const nextRecurrenceEndDate = nextRecurrenceType !== "none"
        ? ((taskData as any).recurrenceEndDate ?? oldTask.recurrenceEndDate)
        : undefined;
      const rawRotation = Object.prototype.hasOwnProperty.call(taskData, "rotationMemberIds")
        ? (taskData as any).rotationMemberIds
        : oldTask.rotationMemberIds;
      const nextRotation = nextRecurrenceType !== "none" && Array.isArray(rawRotation)
        ? rawRotation.map((id: unknown) => String(id || "").trim()).filter(Boolean)
        : undefined;

      const updatedTask: Task = {
        ...oldTask,
        ...taskData,
        rewardPoints: Math.max(0, Number((taskData as any).rewardPoints ?? oldTask.rewardPoints ?? 0)),
        recurrenceType: nextRecurrenceType,
        recurrenceInterval: Math.max(1, Number((taskData as any).recurrenceInterval ?? oldTask.recurrenceInterval ?? 1)),
        recurrenceEndDate: nextRecurrenceEndDate,
        rotationMemberIds: nextRotation && nextRotation.length > 0 ? nextRotation : undefined,
        sourceRecurringTaskId: (taskData as any).sourceRecurringTaskId ?? oldTask.sourceRecurringTaskId ?? null,
        completedById: effectiveCompleting ? userId : (taskData.completedById ?? oldTask.completedById ?? null),
        completedAt: effectiveCompleting ? nowStr : (taskData.completedAt ?? oldTask.completedAt ?? null),
        comments: taskData.comments || oldTask.comments || [],
        history: updatedHistory,
        updatedAt: nowStr
      } as Task;

      // Trẻ báo xong nhưng cần duyệt: giữ ở "đang làm", gắn cờ chờ duyệt, chưa cộng điểm.
      if (needsApproval) {
        updatedTask.status = "in_progress" as any;
        updatedTask.pendingApproval = true;
        updatedTask.submittedById = userId;
        updatedTask.submittedAt = nowStr;
        updatedTask.completedById = null;
        updatedTask.completedAt = null;
        updatedTask.rejectionReason = null;
      } else if (isCompleting) {
        updatedTask.pendingApproval = false;
      }

      db.tasks[idx] = updatedTask;

      // Mở lại việc đã hoàn thành = bắt đầu một LƯỢT MỚI (dùng lại 1 task thay vì tạo mới):
      // reset cờ chờ duyệt/bằng chứng để làm lại từ đầu. Điểm đã cộng ở lượt trước GIỮ NGUYÊN —
      // mỗi lần hoàn thành là một lượt được thưởng riêng, cộng dồn.
      const isReopening = oldTask.status === "completed" && updatedTask.status !== "completed";
      if (isReopening) {
        updatedTask.pendingApproval = false;
        updatedTask.submittedById = null;
        updatedTask.submittedAt = null;
        updatedTask.rejectionReason = null;
        updatedTask.proofImage = null;
        updatedTask.proofNote = null;
      }

      if (needsApproval) {
        const submitter = db.users.find(u => u.id === userId);
        this.notifyAdults(db, "⏳ Chờ duyệt hoàn thành", `${submitter?.fullName || "Bé"} báo đã xong "${updatedTask.title}". Vào duyệt để cộng ${updatedTask.rewardPoints} điểm nhé.`, "task");
      }

      if (effectiveCompleting && updatedTask.rewardPoints && updatedTask.rewardPoints > 0) {
        // Ưu tiên trẻ đã "báo xong" (submittedById) — để khi ba mẹ duyệt, điểm về đúng
        // trẻ đã làm chứ không phải người duyệt; nếu không có thì dùng người được giao / người bấm.
        const awardUserId = updatedTask.submittedById || updatedTask.assigneeId || userId;
        const awardUser = db.users.find(u => u.id === awardUserId);
        // Mỗi lần chuyển sang "hoàn thành" là một lượt thưởng riêng (cộng dồn qua các lần
        // mở lại). Chốt effectiveCompleting = chỉ cộng đúng lúc CHUYỂN trạng thái nên không
        // bị cộng trùng khi chỉ sửa/lưu lại một task vốn đã hoàn thành.
        if (awardUser?.role === UserRole.CHILD) {
          db.rewardLedger.unshift({
            id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            userId: awardUserId,
            taskId: updatedTask.id,
            points: updatedTask.rewardPoints,
            reason: `Hoan thanh: ${updatedTask.title}`,
            createdById: userId,
            createdAt: nowStr
          });
          this.addNotificationInternal(db, awardUserId, "Diem thuong moi", `Con vua nhan ${updatedTask.rewardPoints} diem vi hoan thanh "${updatedTask.title}".`, "task");
        }
      }

      if (effectiveCompleting && updatedTask.recurrenceType && updatedTask.recurrenceType !== "none") {
        const nextDueDate = advanceDateString(updatedTask.dueDate, updatedTask.recurrenceType, updatedTask.recurrenceInterval || 1);
        const recurrenceEnd = updatedTask.recurrenceEndDate ? parseLocalDateTime(`${updatedTask.recurrenceEndDate} 23:59`) : null;
        const nextDue = nextDueDate ? parseLocalDateTime(nextDueDate) : null;
        const rootId = updatedTask.sourceRecurringTaskId || updatedTask.id;
        const alreadyGenerated = nextDueDate && db.tasks.some(t =>
          (t.sourceRecurringTaskId === rootId || t.id === rootId) &&
          t.dueDate === nextDueDate &&
          t.status !== "completed"
        );

        if (nextDueDate && nextDue && (!recurrenceEnd || nextDue.getTime() <= recurrenceEnd.getTime()) && !alreadyGenerated) {
          // Xoay vòng người nhận: chuyển sang thành viên kế tiếp trong danh sách (nếu có cấu hình).
          let nextAssignee = updatedTask.assigneeId;
          const rotation = (updatedTask.rotationMemberIds || []).filter(Boolean);
          if (rotation.length > 0) {
            const curIdx = rotation.indexOf(updatedTask.assigneeId || "");
            nextAssignee = rotation[(curIdx + 1) % rotation.length];
          }
          const nextTask: Task = {
            ...updatedTask,
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            status: "todo" as any,
            dueDate: nextDueDate,
            assigneeId: nextAssignee,
            sourceRecurringTaskId: rootId,
            completedById: null,
            completedAt: null,
            // Bản lặp kế tiếp bắt đầu tinh khôi: xóa trạng thái duyệt/bằng chứng của lần trước.
            pendingApproval: false,
            submittedById: null,
            submittedAt: null,
            proofImage: null,
            proofNote: null,
            rejectionReason: null,
            comments: [],
            history: [{
              id: `h_${Date.now()}_next`,
              userId,
              username,
              action: "Tu tao tu task lap lai",
              createdAt: nowStr
            }],
            createdAt: nowStr,
            updatedAt: nowStr
          };
          db.tasks.push(nextTask);
        }
      }

      this.writeRaw(db);
      this.logActivity(userId, username, "Cập nhật Task", `Đã sửa đổi công việc "${updatedTask.title}".`);
      return updatedTask;
    } else {
      // CREATE Task
      const newTask: Task = {
        id: `task_${Date.now()}`,
        title: taskData.title || "Công việc mới",
        description: taskData.description || "",
        status: taskData.status || ("todo" as any),
        priority: taskData.priority || ("medium" as any),
        dueDate: taskData.dueDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10) + " 12:00",
        creatorId: userId,
        assigneeId: taskData.assigneeId || null,
        isShared: taskData.isShared !== undefined ? taskData.isShared : true,
        tags: taskData.tags || [],
        rewardPoints: Math.max(0, Number((taskData as any).rewardPoints || 0)),
        completedById: null,
        completedAt: null,
        recurrenceType: (taskData as any).recurrenceType || "none",
        recurrenceInterval: Math.max(1, Number((taskData as any).recurrenceInterval || 1)),
        recurrenceEndDate: (taskData as any).recurrenceEndDate || undefined,
        rotationMemberIds: (taskData as any).rotationMemberIds || undefined,
        sourceRecurringTaskId: null,
        comments: [],
        history: [{
          id: `h_${Date.now()}`,
          userId,
          username,
          action: "Đã khởi tạo công việc này",
          createdAt: nowStr
        }],
        createdAt: nowStr,
        updatedAt: nowStr
      };

      db.tasks.push(newTask);
      this.logActivity(userId, username, "Tạo Task", `Đã lập công việc mới "${newTask.title}".`);

      // Push notification to assignee
      if (newTask.assigneeId && newTask.assigneeId !== userId) {
        this.addNotificationInternal(db, newTask.assigneeId, "Công việc mới được giao", `Bạn vừa được giao nhiệm vụ: "${newTask.title}"`);
      } else if (newTask.isShared) {
        this.addNotificationInternal(db, "all", "Công việc gia đình mới", `Cả nhà ơi có nhiệm vụ: "${newTask.title}"`);
      }

      this.writeRaw(db);
      this.logActivity(userId, username, "Tạo Task", `Đã lập công việc mới "${newTask.title}".`);
      return newTask;
    }
  }

  // Gửi thông báo (in-app + push) tới mọi người lớn trong nhà (Admin + Member).
  private static notifyAdults(db: FamilyOrganizerDB, title: string, content: string, type: Notification["type"] = "system"): void {
    db.users
      .filter(u => u.role === UserRole.ADMIN || u.role === UserRole.MEMBER)
      .forEach(u => this.addNotificationInternal(db, u.id, title, content, type));
  }

  // Người lớn DUYỆT việc trẻ đã báo xong → hoàn thành + cộng điểm (tái dùng saveTask
  // với actor là người lớn nên không bị gate lại; điểm vẫn về cho trẻ nhận việc).
  public static approveTaskCompletion(taskId: string, approverId: string, approverName: string): Task {
    const db = this.readRaw();
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) throw new Error("Task không tồn tại");
    if (!task.pendingApproval) throw new Error("Công việc này không ở trạng thái chờ duyệt.");
    return this.saveTask({ id: taskId, status: "completed" as any }, approverId, approverName);
  }

  // Người lớn TRẢ LẠI việc → về "đang làm", ghi lý do, báo trẻ làm lại. Không cộng điểm.
  public static rejectTaskCompletion(taskId: string, approverId: string, approverName: string, reason?: string): Task {
    const db = this.readRaw();
    const idx = db.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) throw new Error("Task không tồn tại");
    const task = db.tasks[idx];
    if (!task.pendingApproval) throw new Error("Công việc này không ở trạng thái chờ duyệt.");
    const nowStr = new Date().toISOString();
    const reasonText = (reason || "").trim();
    task.status = "in_progress" as any;
    task.pendingApproval = false;
    task.rejectionReason = reasonText || null;
    task.completedById = null;
    task.completedAt = null;
    task.updatedAt = nowStr;
    task.history = [
      {
        id: `h_${Date.now()}`,
        userId: approverId,
        username: approverName,
        action: reasonText ? `Đã trả lại để làm lại: ${reasonText}` : "Đã trả lại để làm lại",
        createdAt: nowStr
      },
      ...(task.history || [])
    ];
    if (task.assigneeId) {
      this.addNotificationInternal(
        db,
        task.assigneeId,
        "🔁 Cần làm lại",
        reasonText ? `Ba mẹ trả lại việc "${task.title}": ${reasonText}` : `Ba mẹ trả lại việc "${task.title}", con làm lại nhé.`,
        "task"
      );
    }
    this.writeRaw(db);
    this.logActivity(approverId, approverName, "Trả lại Task", `Đã trả lại công việc "${task.title}" để làm lại.`);
    return task;
  }

  public static addCommentToTask(taskId: string, commentContent: string, userId: string, username: string): Task {
    const db = this.readRaw();
    const idx = db.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) throw new Error("Task không tồn tại");

    const task = db.tasks[idx];
    const newComment = {
      id: `c_${Date.now()}`,
      userId,
      username,
      content: commentContent,
      createdAt: new Date().toISOString()
    };

    task.comments.push(newComment);
    task.history.unshift({
      id: `h_${Date.now()}`,
      userId,
      username,
      action: `Đã bình luận: "${commentContent.substring(0, 30)}${commentContent.length > 30 ? "..." : ""}"`,
      createdAt: new Date().toISOString()
    });
    task.updatedAt = new Date().toISOString();

    db.tasks[idx] = task;
    this.writeRaw(db);
    this.logActivity(userId, username, "Bình luận Task", `Đã bình luận trong công việc "${task.title}".`);
    return task;
  }

  public static deleteTask(taskId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;

    const taskTitle = db.tasks[idx].title;
    db.tasks.splice(idx, 1);
    this.writeRaw(db);
    this.logActivity(userId, username, "Xóa Task", `Đã xóa công việc "${taskTitle}".`);
  }

  // Plans Management
  public static savePlan(planData: Partial<FamilyPlan>, userId: string, username: string): FamilyPlan {
    const db = this.readRaw();
    const nowStr = new Date().toISOString();

    if (planData.id) {
      // UPDATE
      const idx = db.plans.findIndex(p => p.id === planData.id);
      if (idx === -1) throw new Error("Kế hoạch không tồn tại");

      const updated = {
        ...db.plans[idx],
        ...planData
      } as FamilyPlan;

      db.plans[idx] = updated;
      this.writeRaw(db);
      this.logActivity(userId, username, "Cập nhật Lịch trình", `Đã cập nhật sự kiện "${updated.title}".`);
      return updated;
    } else {
      // CREATE
      const newPlan: FamilyPlan = {
        id: `plan_${Date.now()}`,
        title: planData.title || "Kế hoạch mới",
        description: planData.description || "",
        startDate: planData.startDate || new Date().toISOString().slice(0, 16).replace("T", " "),
        // Sự kiện lặp lại bỏ trống ngày kết thúc = lặp VÔ HẠN → giữ "" (KHÔNG ép về giờ hiện tại).
        // Sự kiện 1 lần không có mốc kết thúc → mặc định +1 giờ để vẽ khoảng hợp lý.
        endDate: (typeof planData.endDate === "string" && planData.endDate.trim())
          ? planData.endDate.trim()
          : (planData.isRecurring ? "" : new Date(Date.now() + 3600000).toISOString().slice(0, 16).replace("T", " ")),
        isRecurring: planData.isRecurring || false,
        recurrenceType: planData.recurrenceType || "none",
        // Lưu các thứ trong tuần cho lịch lặp hằng tuần (vd chọn Thứ 4 dù bắt đầu Thứ 5).
        // Thiếu dòng này thì CREATE bỏ mất → hệ thống lặp nhầm theo thứ của ngày bắt đầu.
        recurrenceWeekdays: Array.isArray(planData.recurrenceWeekdays)
          ? planData.recurrenceWeekdays.map((d: any) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
          : undefined,
        creatorId: userId,
        isShared: planData.isShared !== undefined ? planData.isShared : true,
        color: planData.color || "sky",
        createdAt: nowStr
      };

      db.plans.push(newPlan);
      this.writeRaw(db);
      this.logActivity(userId, username, "Tạo Lịch trình", `Đã lập lịch trình mới: "${newPlan.title}".`);

      if (newPlan.isShared) {
        this.addNotificationInternal(db, "all", "Sự kiện gia đình mới", `Lịch gia đình có sự kiện mới: "${newPlan.title}" vào ngày ${newPlan.startDate.substring(0, 10)}`);
      }

      return newPlan;
    }
  }

  public static deletePlan(planId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.plans.findIndex(p => p.id === planId);
    if (idx === -1) return;

    const title = db.plans[idx].title;
    db.plans.splice(idx, 1);
    this.writeRaw(db);
    this.logActivity(userId, username, "Xóa Lịch trình", `Đã xóa sự kiện "${title}".`);
  }

  // Notes Management
  // Các URL ảnh do app quản lý (/uploads/notes/...) nhúng trong markdown của ghi chú.
  private static extractNoteImageUrls(content: string | undefined): string[] {
    return String(content || "").match(/\/uploads\/notes\/[a-zA-Z0-9_\-./]+/g) || [];
  }

  public static saveNote(noteData: Partial<Note>, userId: string, username: string): Note {
    const db = this.readRaw();
    const nowStr = new Date().toISOString();

    if (noteData.id) {
      // UPDATE Note
      const idx = db.notes.findIndex(n => n.id === noteData.id);
      if (idx === -1) throw new Error("Ghi chú không tồn tại");

      const oldNote = db.notes[idx];

      const updatedNote: Note = {
        ...oldNote,
        ...noteData,
        updatedAt: nowStr
      } as Note;

      // Ảnh nhúng bị gỡ khỏi nội dung → xóa file mồ côi trên đĩa.
      if (noteData.content !== undefined) {
        const kept = new Set(this.extractNoteImageUrls(updatedNote.content));
        this.extractNoteImageUrls(oldNote.content).forEach(url => {
          if (!kept.has(url)) deleteMediaByUrl(url);
        });
      }

      db.notes[idx] = updatedNote;
      this.writeRaw(db);
      this.logActivity(userId, username, "Cập nhật Ghi chú", `Đã chỉnh sửa ghi chú "${updatedNote.title}".`);
      return updatedNote;
    } else {
      // CREATE Note
      const newNote: Note = {
        id: `note_${Date.now()}`,
        title: noteData.title || "Ghi chú không tên",
        content: noteData.content || "",
        isPinned: noteData.isPinned || false,
        creatorId: userId,
        tags: noteData.tags || [],
        isShared: noteData.isShared !== undefined ? noteData.isShared : true,
        allowedRolesToEdit: noteData.allowedRolesToEdit || [UserRole.ADMIN, UserRole.MEMBER],
        createdAt: nowStr,
        updatedAt: nowStr
      };

      db.notes.push(newNote);
      this.writeRaw(db);
      this.logActivity(userId, username, "Tạo Ghi chú", `Đã tạo ghi chú "${newNote.title}".`);

      return newNote;
    }
  }

  public static deleteNote(noteId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.notes.findIndex(n => n.id === noteId);
    if (idx === -1) return;

    const title = db.notes[idx].title;
    // Dọn các ảnh nhúng trong ghi chú khỏi đĩa.
    this.extractNoteImageUrls(db.notes[idx].content).forEach(url => deleteMediaByUrl(url));
    db.notes.splice(idx, 1);
    this.writeRaw(db);
    this.logActivity(userId, username, "Xóa Ghi chú", `Đã xóa ghi chú "${title}".`);
  }

  // Nhãn tiếng Việt cho nhật ký tài chính (đồng bộ với translateCategory/translateAccount phía client).
  // Hạng mục thu nhập là free-text tiếng Việt nên trả nguyên văn nếu không có trong map.
  private static readonly TX_CATEGORY_LABELS: Record<string, string> = {
    food: "Ăn uống", education2: "Học tập", utilities: "Điện nước", shopping: "Mua sắm",
    medical: "Y tế", transport: "Đi lại", debt_bank: "Trả nợ NH", debt_personal: "Trả nợ CN",
    funeral: "Ma chay", ceremony: "Hiếu hỉ", rent: "Thuê nhà", internet: "Cước Internet",
    phone: "Điện thoại", insurance: "Bảo hiểm", loan: "Trả nợ NH", other: "Khác"
  };
  private static readonly TX_ACCOUNT_LABELS: Record<string, string> = {
    cash: "Tiền mặt", bank: "Ngân hàng", e_wallet: "Ví điện tử"
  };

  // Liệt kê các thay đổi "cũ → mới" giữa 2 bản giao dịch — để nhật ký minh bạch từng chỉnh sửa.
  private static describeTransactionChanges(oldTx: FinancialTransaction, newTx: FinancialTransaction): string[] {
    const changes: string[] = [];
    if (oldTx.type !== newTx.type)
      changes.push(`loại ${oldTx.type === "income" ? "Thu" : "Chi"} → ${newTx.type === "income" ? "Thu" : "Chi"}`);
    if (oldTx.amount !== newTx.amount)
      changes.push(`số tiền ${oldTx.amount.toLocaleString()} → ${newTx.amount.toLocaleString()} VNĐ`);
    if (oldTx.description !== newTx.description)
      changes.push(`nội dung "${oldTx.description}" → "${newTx.description}"`);
    if (oldTx.date !== newTx.date)
      changes.push(`ngày ${oldTx.date} → ${newTx.date}`);
    if (oldTx.category !== newTx.category)
      changes.push(`hạng mục ${this.TX_CATEGORY_LABELS[oldTx.category] || oldTx.category} → ${this.TX_CATEGORY_LABELS[newTx.category] || newTx.category}`);
    if (oldTx.account !== newTx.account)
      changes.push(`ví ${this.TX_ACCOUNT_LABELS[oldTx.account] || oldTx.account} → ${this.TX_ACCOUNT_LABELS[newTx.account] || newTx.account}`);
    if ((oldTx.receiptImage || "") !== (newTx.receiptImage || ""))
      changes.push(newTx.receiptImage ? (oldTx.receiptImage ? "thay ảnh hóa đơn" : "thêm ảnh hóa đơn") : "gỡ ảnh hóa đơn");
    return changes;
  }

  // Financial transactions management
  public static saveTransaction(txData: Partial<FinancialTransaction>, userId: string, username: string): FinancialTransaction {
    const db = this.readRaw();

    const newTx: FinancialTransaction = {
      id: txData.id ? txData.id : `tx_${Date.now()}`,
      type: txData.type || ("expense" as any),
      amount: txData.amount || 0,
      category: txData.category || "other",
      account: txData.account || ("bank" as any),
      description: txData.description || "",
      date: txData.date || new Date().toISOString().slice(0, 10),
      creatorId: userId,
      receiptImage: txData.receiptImage, // Base64 supported
      createdAt: txData.createdAt || new Date().toISOString()
    };

    if (txData.id) {
      // UPDATE — giữ nguyên người tạo & thời điểm tạo gốc (admin sửa hộ không đổi chủ bản ghi)
      const idx = db.transactions.findIndex(t => t.id === txData.id);
      if (idx === -1) throw new Error("Giao dịch không tồn tại");
      const oldTx = db.transactions[idx];
      newTx.creatorId = oldTx.creatorId;
      newTx.createdAt = oldTx.createdAt;
      if (oldTx.receiptImage && oldTx.receiptImage !== newTx.receiptImage) deleteMediaByUrl(oldTx.receiptImage);
      db.transactions[idx] = newTx;
      // Nhật ký minh bạch: ghi rõ từng trường đã đổi (cũ → mới) thay vì chỉ "đã điều chỉnh"
      const changes = this.describeTransactionChanges(oldTx, newTx);
      this.logActivity(
        userId, username, "Sửa giao dịch tài chính",
        changes.length > 0
          ? `Đã sửa giao dịch "${oldTx.description}": ${changes.join("; ")}.`
          : `Đã lưu lại giao dịch "${newTx.description}" (không có thay đổi).`
      );
    } else {
      // CREATE
      db.transactions.push(newTx);
      this.logActivity(userId, username, "Ghi chép tài chính", `Đã ghi lại ${newTx.type === "expense" ? "khoản chi" : "khoản thu"} "${newTx.description}" (${newTx.amount.toLocaleString()} VNĐ)`);
    }

    this.writeRaw(db);
    return newTx;
  }

  public static deleteTransaction(txId: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.transactions.findIndex(t => t.id === txId);
    if (idx === -1) return;

    const tx = db.transactions[idx];
    db.transactions.splice(idx, 1);
    this.writeRaw(db);
    deleteMediaByUrl(tx.receiptImage); // remove the stored receipt file, if any
    this.logActivity(userId, username, "Xóa giao dịch tài chính", `Đã xóa giao dịch "${tx.description}" (${tx.amount.toLocaleString()} VNĐ).`);
  }

  // --- REWARD POINTS ---
  public static addRewardEntry(data: Partial<RewardPointEntry>, userId: string, username: string): RewardPointEntry {
    const db = this.readRaw();
    const target = db.users.find(u => u.id === data.userId);
    if (!target) throw new Error("Không tìm thấy thành viên nhận điểm");
    const points = Number(data.points || 0);
    if (!points) throw new Error("Số điểm không hợp lệ");

    const entry: RewardPointEntry = {
      id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: target.id,
      taskId: data.taskId,
      points,
      reason: data.reason || "Dieu chinh diem",
      createdById: userId,
      createdAt: new Date().toISOString()
    };
    db.rewardLedger.unshift(entry);
    this.writeRaw(db);
    this.logActivity(userId, username, "Điểm thưởng", `Đã cập nhật ${points} điểm cho ${target.fullName}.`);
    return entry;
  }

  // --- CỬA HÀNG ĐỔI THƯỞNG (quà đổi bằng điểm rewardLedger) ---

  public static getRewardItems(): RewardItem[] {
    return this.readRaw().rewardItems;
  }

  public static saveRewardItem(data: Partial<RewardItem>, userId: string, username: string): RewardItem {
    const db = this.readRaw();
    const now = new Date().toISOString();
    const name = String(data.name || "").trim();
    if (!name) throw new Error("Tên món quà không được bỏ trống");
    const cost = Math.round(Number(data.cost) || 0);
    if (cost <= 0) throw new Error("Số điểm đổi quà phải lớn hơn 0");
    const emoji = String(data.emoji || "").trim().slice(0, 8) || undefined;

    if (data.id) {
      const idx = db.rewardItems.findIndex(i => i.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy món quà");
      db.rewardItems[idx] = {
        ...db.rewardItems[idx],
        name, cost, emoji,
        isActive: data.isActive !== undefined ? !!data.isActive : db.rewardItems[idx].isActive,
        updatedAt: now
      };
      this.writeRaw(db);
      return db.rewardItems[idx];
    }

    const item: RewardItem = {
      id: `rwitem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name, cost, emoji,
      isActive: data.isActive !== undefined ? !!data.isActive : true,
      createdAt: now,
      updatedAt: now
    };
    db.rewardItems.unshift(item);
    this.writeRaw(db);
    this.logActivity(userId, username, "Đổi thưởng", `Đã thêm quà "${name}" (${cost} điểm).`);
    return item;
  }

  public static deleteRewardItem(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const item = db.rewardItems.find(i => i.id === id);
    if (!item) return;
    db.rewardItems = db.rewardItems.filter(i => i.id !== id);
    this.writeRaw(db);
    this.logActivity(userId, username, "Đổi thưởng", `Đã xóa quà "${item.name}".`);
  }

  /**
   * Trẻ đổi quà: kiểm tra đủ điểm rồi ghi bút toán ÂM vào rewardLedger (cùng sổ
   * với điểm thưởng task — lịch sử cộng/trừ nằm một chỗ). Báo cả nhà biết cho vui.
   */
  public static redeemRewardItem(itemId: string, childId: string, byUserId: string, byUsername: string): RewardPointEntry {
    const db = this.readRaw();
    const item = db.rewardItems.find(i => i.id === itemId);
    if (!item || !item.isActive) throw new Error("Món quà không tồn tại hoặc đã tắt");
    const child = db.users.find(u => u.id === childId);
    if (!child) throw new Error("Không tìm thấy thành viên đổi quà");

    const balance = db.rewardLedger
      .filter(e => e.userId === childId)
      .reduce((s, e) => s + e.points, 0);
    if (balance < item.cost) {
      throw new Error(`Chưa đủ điểm: cần ${item.cost}, hiện có ${balance}.`);
    }

    const entry: RewardPointEntry = {
      id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: childId,
      points: -item.cost,
      reason: `🎁 Đổi quà: ${item.name}`,
      createdById: byUserId,
      createdAt: new Date().toISOString()
    };
    db.rewardLedger.unshift(entry);
    this.addNotificationInternal(db, "all", "🎁 Đổi thưởng", `${child.fullName} vừa đổi "${item.emoji ? item.emoji + " " : ""}${item.name}" (−${item.cost} điểm, còn ${balance - item.cost}).`);
    this.writeRaw(db);
    this.logActivity(byUserId, byUsername, "Đổi thưởng", `${child.fullName} đổi quà "${item.name}" (−${item.cost} điểm).`);
    return entry;
  }

  /** Mẫu quà sẵn — chỉ thêm nếu danh sách hiện tại TRỐNG (không ghi đè quà đã có). */
  public static seedDefaultRewardItems(userId: string, username: string): RewardItem[] {
    const db = this.readRaw();
    if (db.rewardItems.length > 0) return db.rewardItems; // đã có quà, không thêm
    const now = new Date().toISOString();
    const defaults: Array<{ emoji: string; name: string; cost: number }> = [
      { emoji: "🎮", name: "30 phút chơi game",                cost: 30 },
      { emoji: "📱", name: "30 phút xem YouTube / điện thoại", cost: 30 },
      { emoji: "📚", name: "Bố/mẹ đọc truyện 2 cuốn",         cost: 20 },
      { emoji: "🍦", name: "Mua kem / bánh yêu thích",         cost: 50 },
      { emoji: "🍕", name: "Chọn món ăn tối cả nhà",           cost: 60 },
      { emoji: "🎬", name: "Xem phim cùng bố/mẹ",              cost: 40 },
      { emoji: "🏊", name: "Đi bơi / hồ bơi",                  cost: 80 },
      { emoji: "🎡", name: "Đi công viên vui chơi",             cost: 100 }
    ];
    db.rewardItems = defaults.map((d, i) => ({
      id: `rwitem_default_${i}_${Date.now()}`,
      name: d.name, emoji: d.emoji, cost: d.cost,
      isActive: true, createdAt: now, updatedAt: now
    }));
    this.writeRaw(db);
    this.logActivity(userId, username, "Đổi thưởng", "Đã tạo 8 món quà mẫu mặc định.");
    return db.rewardItems;
  }

  /**
   * Đổi quà BẤT NGỜ: server chọn ngẫu nhiên 1 món trong danh sách đang bật,
   * trừ điểm với giá mystery = ⌊trung bình × 0.7⌋ (giảm ~30% so với chọn cụ thể).
   */
  public static redeemMysteryItem(childId: string, byUserId: string, byUsername: string): {
    entry: RewardPointEntry; item: RewardItem; mysteryCost: number
  } {
    const db = this.readRaw();
    const active = db.rewardItems.filter(i => i.isActive);
    if (active.length === 0) throw new Error("Cửa hàng chưa có món quà nào để chọn ngẫu nhiên.");

    const child = db.users.find(u => u.id === childId);
    if (!child) throw new Error("Không tìm thấy thành viên đổi quà");

    const avgCost = active.reduce((s, i) => s + i.cost, 0) / active.length;
    const mysteryCost = Math.max(1, Math.floor(avgCost * 0.7));

    const balance = db.rewardLedger
      .filter(e => e.userId === childId)
      .reduce((s, e) => s + e.points, 0);
    if (balance < mysteryCost) {
      throw new Error(`Chưa đủ điểm: cần ${mysteryCost} (quà bất ngờ), hiện có ${balance}.`);
    }

    const item = active[Math.floor(Math.random() * active.length)];
    const entry: RewardPointEntry = {
      id: `reward_mystery_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: childId,
      points: -mysteryCost,
      reason: `🎲 Quà bất ngờ: ${item.name}`,
      createdById: byUserId,
      createdAt: new Date().toISOString()
    };
    db.rewardLedger.unshift(entry);
    this.addNotificationInternal(db, "all", "🎲 Quà bất ngờ!", `${child.fullName} vừa quay được "${item.emoji ? item.emoji + " " : ""}${item.name}" (−${mysteryCost} điểm, còn ${balance - mysteryCost}).`);
    this.writeRaw(db);
    this.logActivity(byUserId, byUsername, "Đổi thưởng", `${child.fullName} đổi quà bất ngờ "${item.name}" (−${mysteryCost} điểm).`);
    return { entry, item, mysteryCost };
  }

  // --- BUDGETS + RECURRING BILLS ---
  public static saveBudget(data: Partial<BudgetLimit>, userId: string, username: string): BudgetLimit {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.month || !data.category || !data.limit) throw new Error("Thiếu tháng, hạng mục hoặc hạn mức ngân sách");

    if (data.id) {
      const idx = db.budgets.findIndex(b => b.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy ngân sách");
      const updated = { ...db.budgets[idx], ...data, limit: Number(data.limit), updatedAt: now } as BudgetLimit;
      db.budgets[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const existingIdx = db.budgets.findIndex(b => b.month === data.month && b.category === data.category);
    const budget: BudgetLimit = {
      id: existingIdx >= 0 ? db.budgets[existingIdx].id : `budget_${Date.now()}`,
      month: data.month,
      category: data.category,
      limit: Number(data.limit),
      createdAt: existingIdx >= 0 ? db.budgets[existingIdx].createdAt : now,
      updatedAt: now
    };
    if (existingIdx >= 0) db.budgets[existingIdx] = budget;
    else db.budgets.unshift(budget);
    this.writeRaw(db);
    this.logActivity(userId, username, "Ngân sách", `Đã đặt ngân sách ${budget.category} tháng ${budget.month}.`);
    return budget;
  }

  public static deleteBudget(id: string): void {
    const db = this.readRaw();
    db.budgets = db.budgets.filter(b => b.id !== id);
    this.writeRaw(db);
  }

  // ─── Hạng mục CHI tùy chỉnh (Admin) ──────────────────────────────────────
  // Cấu hình = danh sách hạng mục tự thêm + danh sách key mặc định bị ẩn.
  public static getCategoryConfig(): { customCategories: CustomExpenseCategory[]; hiddenBuiltinCategories: string[] } {
    const db = this.readRaw();
    return {
      customCategories: db.customCategories,
      hiddenBuiltinCategories: db.hiddenBuiltinCategories
    };
  }

  public static saveCustomCategory(data: Partial<CustomExpenseCategory>, userId: string, username: string): CustomExpenseCategory {
    const db = this.readRaw();
    const now = new Date().toISOString();
    const label = String(data.label || "").trim();
    if (!label) throw new Error("Tên hạng mục không được để trống");
    // Emoji/màu tùy chọn — mặc định nhãn 🏷️ + màu slate khi để trống.
    const emoji = String(data.emoji || "").trim() || "🏷️";
    const color = String(data.color || "").trim() || "slate";

    if (data.id) {
      const idx = db.customCategories.findIndex(c => c.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy hạng mục");
      const updated: CustomExpenseCategory = { ...db.customCategories[idx], label, emoji, color, updatedAt: now };
      db.customCategories[idx] = updated;
      this.writeRaw(db);
      this.logActivity(userId, username, "Hạng mục chi", `Đã cập nhật hạng mục "${label}".`);
      return updated;
    }

    // Không cho trùng tên (không phân biệt hoa/thường) với hạng mục tự thêm khác.
    if (db.customCategories.some(c => c.label.toLowerCase() === label.toLowerCase())) {
      throw new Error("Đã có hạng mục tự thêm trùng tên này");
    }
    const cat: CustomExpenseCategory = {
      id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label, emoji, color, createdAt: now, updatedAt: now
    };
    db.customCategories.push(cat);
    this.writeRaw(db);
    this.logActivity(userId, username, "Hạng mục chi", `Đã thêm hạng mục "${label}".`);
    return cat;
  }

  public static deleteCustomCategory(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const cat = db.customCategories.find(c => c.id === id);
    db.customCategories = db.customCategories.filter(c => c.id !== id);
    this.writeRaw(db);
    if (cat) this.logActivity(userId, username, "Hạng mục chi", `Đã xóa hạng mục "${cat.label}".`);
  }

  // Đặt danh sách key hạng mục MẶC ĐỊNH bị ẩn (chỉ giữ chuỗi hợp lệ, khử trùng lặp).
  public static setHiddenBuiltinCategories(keys: string[], userId: string, username: string): string[] {
    const db = this.readRaw();
    const cleaned = Array.from(new Set((Array.isArray(keys) ? keys : []).map(k => String(k || "").trim()).filter(Boolean)));
    db.hiddenBuiltinCategories = cleaned;
    this.writeRaw(db);
    this.logActivity(userId, username, "Hạng mục chi", `Đã cập nhật danh sách hạng mục mặc định bị ẩn (${cleaned.length}).`);
    return cleaned;
  }

  /**
   * Mang ngân sách sang tháng mới: nếu targetMonth chưa có hạn mức nào thì sao
   * chép toàn bộ từ tháng gần nhất trước đó. Idempotent — gọi lại không nhân đôi.
   */
  public static carryForwardBudgets(targetMonth: string, userId: string, username: string): BudgetLimit[] {
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) throw new Error("Tháng không hợp lệ");
    const db = this.readRaw();
    // Đã có hạn mức cho tháng đích → không làm gì
    if (db.budgets.some(b => b.month === targetMonth)) {
      return db.budgets.filter(b => b.month === targetMonth);
    }
    // Tìm tháng gần nhất TRƯỚC tháng đích có đặt ngân sách
    const priorMonths = Array.from(new Set(db.budgets.map(b => b.month)))
      .filter(m => m < targetMonth)
      .sort();
    const sourceMonth = priorMonths[priorMonths.length - 1];
    if (!sourceMonth) return [];
    const now = new Date().toISOString();
    const copied: BudgetLimit[] = db.budgets
      .filter(b => b.month === sourceMonth)
      .map((b, i) => ({
        id: `budget_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        month: targetMonth,
        category: b.category,
        limit: b.limit,
        createdAt: now,
        updatedAt: now
      }));
    if (copied.length === 0) return [];
    db.budgets.unshift(...copied);
    this.writeRaw(db);
    this.logActivity(userId, username, "Ngân sách", `Tự động mang ${copied.length} hạn mức từ tháng ${sourceMonth} sang ${targetMonth}.`);
    return copied;
  }

  public static saveRecurringBill(data: Partial<RecurringBill>, userId: string, username: string): RecurringBill {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.title || !data.amount || !data.nextDueDate) throw new Error("Thiếu tên hóa đơn, số tiền hoặc ngày đến hạn");

    if (data.id) {
      const idx = db.recurringBills.findIndex(b => b.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy hóa đơn định kỳ");
      const updated = {
        ...db.recurringBills[idx],
        ...data,
        amount: Number(data.amount),
        updatedAt: now
      } as RecurringBill;
      db.recurringBills[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const bill: RecurringBill = {
      id: `bill_${Date.now()}`,
      title: data.title.trim(),
      amount: Number(data.amount),
      category: data.category || "utilities",
      account: data.account || ("bank" as any),
      frequency: data.frequency || "monthly",
      nextDueDate: data.nextDueDate,
      notes: data.notes?.trim() || "",
      isActive: data.isActive !== undefined ? data.isActive : true,
      lastPaidDate: data.lastPaidDate,
      createdAt: now,
      updatedAt: now
    };
    db.recurringBills.unshift(bill);
    this.writeRaw(db);
    this.logActivity(userId, username, "Hóa đơn định kỳ", `Đã tạo hóa đơn định kỳ "${bill.title}".`);
    return bill;
  }

  public static deleteRecurringBill(id: string): void {
    const db = this.readRaw();
    db.recurringBills = db.recurringBills.filter(b => b.id !== id);
    this.writeRaw(db);
  }

  // --- Mục tiêu tiết kiệm ---
  public static getSavingsGoals(): SavingsGoal[] {
    return this.readRaw().savingsGoals;
  }

  public static saveSavingsGoal(data: Partial<SavingsGoal>, userId: string, username: string): SavingsGoal {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.name || !data.name.trim()) throw new Error("Thiếu tên mục tiêu tiết kiệm");
    const target = Number(data.targetAmount) || 0;
    if (target <= 0) throw new Error("Số tiền mục tiêu phải lớn hơn 0");

    if (data.id) {
      const idx = db.savingsGoals.findIndex(g => g.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy mục tiêu tiết kiệm");
      const updated: SavingsGoal = {
        ...db.savingsGoals[idx],
        name: data.name.trim(),
        targetAmount: target,
        deadline: data.deadline || undefined,
        color: data.color || db.savingsGoals[idx].color,
        note: data.note?.trim() || undefined,
        isShared: data.isShared !== undefined ? data.isShared : db.savingsGoals[idx].isShared,
        updatedAt: now
        // contributions giữ nguyên — chỉ sửa qua add/removeContribution
      };
      db.savingsGoals[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const goal: SavingsGoal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: data.name.trim(),
      targetAmount: target,
      deadline: data.deadline || undefined,
      color: data.color || "emerald",
      note: data.note?.trim() || undefined,
      isShared: data.isShared !== undefined ? data.isShared : true,
      creatorId: userId,
      contributions: [],
      createdAt: now,
      updatedAt: now
    };
    db.savingsGoals.unshift(goal);
    this.writeRaw(db);
    this.logActivity(userId, username, "Tiết kiệm", `Đã tạo mục tiêu "${goal.name}".`);
    return goal;
  }

  public static deleteSavingsGoal(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const goal = db.savingsGoals.find(g => g.id === id);
    if (!goal) return;
    db.savingsGoals = db.savingsGoals.filter(g => g.id !== id);
    this.writeRaw(db);
    this.logActivity(userId, username, "Tiết kiệm", `Đã xóa mục tiêu "${goal.name}".`);
  }

  public static addSavingsContribution(
    goalId: string,
    data: { amount?: number; date?: string; note?: string },
    userId: string
  ): SavingsGoal {
    const db = this.readRaw();
    const goal = db.savingsGoals.find(g => g.id === goalId);
    if (!goal) throw new Error("Không tìm thấy mục tiêu tiết kiệm");
    const amount = Number(data.amount) || 0;
    if (amount === 0) throw new Error("Số tiền đóng góp phải khác 0");
    const contribution: SavingsContribution = {
      id: `contrib_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      amount,
      date: data.date || new Date().toISOString().slice(0, 10),
      note: data.note?.trim() || undefined,
      byId: userId,
      createdAt: new Date().toISOString()
    };
    goal.contributions.unshift(contribution);
    goal.updatedAt = new Date().toISOString();
    this.writeRaw(db);
    return goal;
  }

  public static removeSavingsContribution(goalId: string, contributionId: string): SavingsGoal {
    const db = this.readRaw();
    const goal = db.savingsGoals.find(g => g.id === goalId);
    if (!goal) throw new Error("Không tìm thấy mục tiêu tiết kiệm");
    goal.contributions = goal.contributions.filter(c => c.id !== contributionId);
    goal.updatedAt = new Date().toISOString();
    this.writeRaw(db);
    return goal;
  }

  // --- Theo dõi vay / cho mượn (nợ) ---
  public static getDebts(): Debt[] {
    return this.readRaw().debts;
  }

  public static saveDebt(data: Partial<Debt>, userId: string, username: string): Debt {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.counterparty || !data.counterparty.trim()) throw new Error("Thiếu tên người/ngân hàng");
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new Error("Số tiền nợ phải lớn hơn 0");
    const direction = data.direction === "lent" ? "lent" : "borrowed";
    // Thông tin liên hệ (tùy chọn) + ảnh đính kèm (giấy tờ, biên nhận chuyển khoản)
    const address = data.address?.trim() || undefined;
    const phone = data.phone?.trim() || undefined;
    const bankName = data.bankName?.trim() || undefined;
    const loanDate = data.loanDate || undefined;
    const attachments = Array.isArray(data.attachments)
      ? data.attachments.filter(u => typeof u === "string" && u.trim()).slice(0, 12)
      : undefined;

    if (data.id) {
      const idx = db.debts.findIndex(d => d.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy khoản nợ");
      const updated: Debt = {
        ...db.debts[idx],
        direction,
        counterparty: data.counterparty.trim(),
        address,
        phone,
        bankName,
        attachments,
        amount,
        loanDate,
        dueDate: data.dueDate || undefined,
        note: data.note?.trim() || undefined,
        isSettled: data.isSettled !== undefined ? data.isSettled : db.debts[idx].isSettled,
        updatedAt: now
        // payments giữ nguyên — chỉ sửa qua add/removeDebtPayment
      };
      db.debts[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const debt: Debt = {
      id: `debt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      direction,
      counterparty: data.counterparty.trim(),
      address,
      phone,
      bankName,
      attachments,
      amount,
      loanDate,
      dueDate: data.dueDate || undefined,
      note: data.note?.trim() || undefined,
      isSettled: false,
      creatorId: userId,
      payments: [],
      createdAt: now,
      updatedAt: now
    };
    db.debts.unshift(debt);
    this.writeRaw(db);
    this.logActivity(userId, username, "Nợ", `Đã thêm khoản ${direction === "lent" ? "cho mượn" : "vay"} với "${debt.counterparty}".`);
    return debt;
  }

  public static deleteDebt(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const debt = db.debts.find(d => d.id === id);
    if (!debt) return;
    db.debts = db.debts.filter(d => d.id !== id);
    this.writeRaw(db);
    this.logActivity(userId, username, "Nợ", `Đã xóa khoản nợ với "${debt.counterparty}".`);
  }

  public static addDebtPayment(
    debtId: string,
    data: { amount?: number; date?: string; note?: string },
    userId: string
  ): Debt {
    const db = this.readRaw();
    const debt = db.debts.find(d => d.id === debtId);
    if (!debt) throw new Error("Không tìm thấy khoản nợ");
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new Error("Số tiền trả phải lớn hơn 0");
    const payment: DebtPayment = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      amount,
      date: data.date || new Date().toISOString().slice(0, 10),
      note: data.note?.trim() || undefined,
      byId: userId,
      createdAt: new Date().toISOString()
    };
    debt.payments.unshift(payment);
    // Tự đánh dấu tất toán khi đã trả đủ (logic thuần ở src/utils/debt).
    if (isDebtFullyPaid(debt)) debt.isSettled = true;
    debt.updatedAt = new Date().toISOString();
    this.writeRaw(db);
    return debt;
  }

  public static removeDebtPayment(debtId: string, paymentId: string): Debt {
    const db = this.readRaw();
    const debt = db.debts.find(d => d.id === debtId);
    if (!debt) throw new Error("Không tìm thấy khoản nợ");
    debt.payments = debt.payments.filter(p => p.id !== paymentId);
    if (!isDebtFullyPaid(debt)) debt.isSettled = false; // mở lại nếu chưa đủ
    debt.updatedAt = new Date().toISOString();
    this.writeRaw(db);
    return debt;
  }

  // --- Sức khỏe trẻ: tiêm chủng ---
  public static getVaccinations(): VaccinationRecord[] {
    return this.readRaw().vaccinations;
  }

  public static saveVaccination(data: Partial<VaccinationRecord>, userId: string, username: string): VaccinationRecord {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.childId) throw new Error("Thiếu thông tin trẻ");
    if (!data.name || !data.name.trim()) throw new Error("Thiếu tên vắc-xin");
    const status = data.status === "done" || data.status === "skipped" ? data.status : "scheduled";

    if (data.id) {
      const idx = db.vaccinations.findIndex(v => v.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy mũi tiêm");
      const updated: VaccinationRecord = {
        ...db.vaccinations[idx],
        childId: data.childId,
        name: data.name.trim(),
        doseLabel: data.doseLabel?.trim() || undefined,
        scheduledDate: data.scheduledDate || undefined,
        doneDate: data.doneDate || undefined,
        status,
        note: data.note?.trim() || undefined,
        updatedAt: now
      };
      db.vaccinations[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const rec: VaccinationRecord = {
      id: `vac_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      childId: data.childId,
      name: data.name.trim(),
      doseLabel: data.doseLabel?.trim() || undefined,
      scheduledDate: data.scheduledDate || undefined,
      doneDate: data.doneDate || undefined,
      status,
      note: data.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now
    };
    db.vaccinations.unshift(rec);
    this.writeRaw(db);
    this.logActivity(userId, username, "Tiêm chủng", `Đã thêm mũi "${rec.name}".`);
    return rec;
  }

  public static deleteVaccination(id: string): void {
    const db = this.readRaw();
    db.vaccinations = db.vaccinations.filter(v => v.id !== id);
    this.writeRaw(db);
  }

  // --- Sức khỏe trẻ: tăng trưởng ---
  public static getGrowthRecords(): GrowthRecord[] {
    return this.readRaw().growthRecords;
  }

  public static saveGrowthRecord(data: Partial<GrowthRecord>, userId: string, username: string): GrowthRecord {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.childId) throw new Error("Thiếu thông tin trẻ");
    if (!data.date) throw new Error("Thiếu ngày đo");
    const rawHeight = (data as any).heightCm;
    const rawWeight = (data as any).weightKg;
    const height = rawHeight !== undefined && rawHeight !== null && rawHeight !== "" ? Number(rawHeight) : undefined;
    const weight = rawWeight !== undefined && rawWeight !== null && rawWeight !== "" ? Number(rawWeight) : undefined;
    if (height === undefined && weight === undefined) {
      throw new Error("Nhập chiều cao hoặc cân nặng");
    }
    if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
      throw new Error("Chiều cao phải lớn hơn 0");
    }
    if (weight !== undefined && (!Number.isFinite(weight) || weight <= 0)) {
      throw new Error("Cân nặng phải lớn hơn 0");
    }

    if (data.id) {
      const idx = db.growthRecords.findIndex(g => g.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy bản ghi");
      const updated: GrowthRecord = {
        ...db.growthRecords[idx],
        childId: data.childId,
        date: data.date,
        heightCm: height,
        weightKg: weight,
        note: data.note?.trim() || undefined
      };
      db.growthRecords[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const rec: GrowthRecord = {
      id: `growth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      childId: data.childId,
      date: data.date,
      heightCm: height,
      weightKg: weight,
      note: data.note?.trim() || undefined,
      createdAt: now
    };
    db.growthRecords.unshift(rec);
    this.writeRaw(db);
    return rec;
  }

  public static deleteGrowthRecord(id: string): void {
    const db = this.readRaw();
    db.growthRecords = db.growthRecords.filter(g => g.id !== id);
    this.writeRaw(db);
  }

  // --- Thẻ khẩn cấp / hồ sơ sức khỏe (mỗi thành viên đúng 1 hồ sơ, id = hp_<userId>) ---

  public static getHealthProfiles(): EmergencyProfile[] {
    return this.readRaw().healthProfiles || [];
  }

  public static saveHealthProfile(data: Partial<EmergencyProfile>, userId: string, username: string): EmergencyProfile {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.userId) throw new Error("Thiếu thông tin thành viên");
    const member = db.users.find(u => u.id === data.userId);
    if (!member) throw new Error("Không tìm thấy thành viên");

    const clean = (v: any, max = 500) => {
      const s = String(v ?? "").trim().slice(0, max);
      return s || undefined;
    };
    const contacts = (Array.isArray(data.emergencyContacts) ? data.emergencyContacts : [])
      .map(c => ({
        name: String(c?.name ?? "").trim().slice(0, 80),
        phone: String(c?.phone ?? "").trim().slice(0, 20),
        relation: clean(c?.relation, 40)
      }))
      .filter(c => c.name && c.phone)
      .slice(0, 5);

    const fields = {
      bloodType: clean(data.bloodType, 5),
      allergies: clean(data.allergies),
      chronicConditions: clean(data.chronicConditions),
      currentMedications: clean(data.currentMedications),
      healthInsuranceNumber: clean(data.healthInsuranceNumber, 30),
      emergencyContacts: contacts,
      notes: clean(data.notes, 1000)
    };

    const id = `hp_${data.userId}`;
    const idx = db.healthProfiles.findIndex(p => p.id === id);
    let profile: EmergencyProfile;
    if (idx !== -1) {
      profile = { ...db.healthProfiles[idx], ...fields, updatedAt: now };
      db.healthProfiles[idx] = profile;
    } else {
      profile = { id, userId: data.userId, ...fields, createdAt: now, updatedAt: now };
      db.healthProfiles.unshift(profile);
    }
    this.writeRaw(db);
    this.logActivity(userId, username, "Thẻ khẩn cấp", `Đã cập nhật hồ sơ sức khỏe của ${member.fullName}.`);
    return profile;
  }

  public static payRecurringBill(id: string, userId: string, username: string): { bill: RecurringBill; transaction: FinancialTransaction } {
    const db = this.readRaw();
    const idx = db.recurringBills.findIndex(b => b.id === id);
    if (idx === -1) throw new Error("Không tìm thấy hóa đơn định kỳ");
    const bill = db.recurringBills[idx];
    const paidDate = new Date().toISOString().slice(0, 10);
    const tx: FinancialTransaction = {
      id: `tx_${Date.now()}`,
      type: "expense" as any,
      amount: bill.amount,
      category: bill.category,
      account: bill.account,
      description: `Thanh toan hoa don: ${bill.title}`,
      date: paidDate,
      creatorId: userId,
      createdAt: new Date().toISOString()
    };
    db.transactions.push(tx);
    const nextDue = advanceDateString(`${bill.nextDueDate} 09:00`, bill.frequency, 1, false) || bill.nextDueDate;
    bill.lastPaidDate = paidDate;
    bill.nextDueDate = nextDue;
    bill.updatedAt = new Date().toISOString();
    db.recurringBills[idx] = bill;
    this.writeRaw(db);
    this.logActivity(userId, username, "Thanh toán hóa đơn", `Đã thanh toán "${bill.title}" (${bill.amount.toLocaleString()} VND).`);
    return { bill, transaction: tx };
  }

  // --- FAMILY ASSETS ---
  public static saveAsset(data: Partial<FamilyAsset>, userId: string, username: string): FamilyAsset {
    const db = this.readRaw();
    const now = new Date().toISOString();
    const safeQuantity = Number.isFinite(Number(data.quantity)) ? Number(data.quantity) : 1;
    const safeEstimatedValue = Number.isFinite(Number(data.estimatedValue)) ? Number(data.estimatedValue) : 0;
    const safePurchaseValue = data.purchaseValue !== undefined && Number.isFinite(Number(data.purchaseValue))
      ? Number(data.purchaseValue)
      : undefined;

    if (data.id) {
      const idx = db.assets.findIndex(a => a.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy tài sản");
      const existing = db.assets[idx];
      const nextName = data.name !== undefined ? String(data.name).trim() : existing.name;
      const updated = {
        ...existing,
        ...data,
        type: data.type && VALID_ASSET_TYPES.has(data.type) ? data.type : existing.type,
        name: nextName || existing.name,
        quantity: safeQuantity,
        estimatedValue: safeEstimatedValue,
        purchaseValue: safePurchaseValue,
        currency: data.currency || existing.currency || "VND",
        photos: Array.isArray(data.photos) ? data.photos : existing.photos || [],
        createdById: existing.createdById,
        createdAt: existing.createdAt,
        updatedAt: now
      } as FamilyAsset;
      db.assets[idx] = updated;
      this.writeRaw(db);
      // Delete files for photos removed during this edit.
      const keptUrls = new Set(assetPhotoUrls(updated));
      assetPhotoUrls(existing).forEach(url => { if (!keptUrls.has(url)) deleteMediaByUrl(url); });
      this.logActivity(userId, username, "Cập nhật tài sản", `Đã cập nhật tài sản "${updated.name}".`);
      return updated;
    }

    const asset: FamilyAsset = {
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: data.type && VALID_ASSET_TYPES.has(data.type) ? data.type : "other",
      name: (data.name || "Tài sản mới").trim(),
      ownerId: data.ownerId || undefined,
      quantity: safeQuantity,
      unit: (data.unit || "mục").trim(),
      estimatedValue: safeEstimatedValue,
      purchaseValue: safePurchaseValue,
      currency: data.currency || "VND",
      purchaseDate: data.purchaseDate || undefined,
      location: data.location?.trim() || "",
      notes: data.notes?.trim() || "",
      photos: Array.isArray(data.photos) ? data.photos : [],
      symbol: data.symbol?.trim() || "",
      network: data.network?.trim() || "",
      walletLabel: data.walletLabel?.trim() || "",
      walletAddressMasked: data.walletAddressMasked?.trim() || "",
      address: data.address?.trim() || "",
      areaM2: data.areaM2 !== undefined && Number.isFinite(Number(data.areaM2)) ? Number(data.areaM2) : undefined,
      certificateNo: data.certificateNo?.trim() || "",
      parcelNo: data.parcelNo?.trim() || "",
      goldPurity: data.goldPurity?.trim() || "",
      weight: data.weight !== undefined && Number.isFinite(Number(data.weight)) ? Number(data.weight) : undefined,
      weightUnit: data.weightUnit?.trim() || "",
      brand: data.brand?.trim() || "",
      serialNo: data.serialNo?.trim() || "",
      createdById: userId,
      createdAt: now,
      updatedAt: now
    };
    db.assets.unshift(asset);
    this.writeRaw(db);
    this.logActivity(userId, username, "Thêm tài sản", `Đã thêm tài sản "${asset.name}" (${asset.estimatedValue.toLocaleString()} ${asset.currency}).`);
    return asset;
  }

  public static deleteAsset(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.assets.findIndex(a => a.id === id);
    if (idx === -1) return;
    const asset = db.assets[idx];
    db.assets.splice(idx, 1);
    this.writeRaw(db);
    // Remove all stored photo files for this asset.
    assetPhotoUrls(asset).forEach(deleteMediaByUrl);
    this.logActivity(userId, username, "Xóa tài sản", `Đã xóa tài sản "${asset.name}".`);
  }

  // --- SHOPPING LIST ---
  public static getShoppingItems() {
    return this.readRaw().shoppingItems;
  }

  public static saveShoppingItem(data: Partial<ShoppingItem>, userId: string, username: string): ShoppingItem {
    const db = this.readRaw();
    const now = new Date().toISOString();

    if (data.id) {
      const idx = db.shoppingItems.findIndex(i => i.id === data.id);
      if (idx === -1) throw new Error("Món đồ không tồn tại");
      const updated = { ...db.shoppingItems[idx], ...data, updatedAt: now } as ShoppingItem;
      db.shoppingItems[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const newItem: ShoppingItem = {
      id: `shop_${Date.now()}`,
      name: (data.name || "Món đồ").trim(),
      quantity: data.quantity?.trim() || "",
      note: data.note?.trim() || "",
      cat: data.cat?.trim() || "",
      isPurchased: false,
      creatorId: userId,
      purchasedById: null,
      createdAt: now,
      updatedAt: now
    };
    db.shoppingItems.unshift(newItem);
    this.writeRaw(db);
    this.logActivity(userId, username, "Thêm đồ đi chợ", `Đã thêm "${newItem.name}" vào danh sách mua sắm.`);
    return newItem;
  }

  public static toggleShoppingItem(id: string, userId: string): ShoppingItem {
    const db = this.readRaw();
    const idx = db.shoppingItems.findIndex(i => i.id === id);
    if (idx === -1) throw new Error("Món đồ không tồn tại");
    const item = db.shoppingItems[idx];
    item.isPurchased = !item.isPurchased;
    item.purchasedById = item.isPurchased ? userId : null;
    item.updatedAt = new Date().toISOString();
    this.writeRaw(db);
    return item;
  }

  public static deleteShoppingItem(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const idx = db.shoppingItems.findIndex(i => i.id === id);
    if (idx === -1) return;
    const name = db.shoppingItems[idx].name;
    db.shoppingItems.splice(idx, 1);
    this.writeRaw(db);
    this.logActivity(userId, username, "Xóa đồ đi chợ", `Đã xóa "${name}" khỏi danh sách mua sắm.`);
  }

  public static clearPurchasedShopping(userId: string, username: string): number {
    const db = this.readRaw();
    const before = db.shoppingItems.length;
    db.shoppingItems = db.shoppingItems.filter(i => !i.isPurchased);
    const removed = before - db.shoppingItems.length;
    if (removed > 0) {
      this.writeRaw(db);
      this.logActivity(userId, username, "Dọn đồ đã mua", `Đã xóa ${removed} món đã mua khỏi danh sách đi chợ.`);
    }
    return removed;
  }

  public static clearAllShopping(userId: string, username: string): number {
    const db = this.readRaw();
    const removed = db.shoppingItems.length;
    if (removed > 0) {
      db.shoppingItems = [];
      this.writeRaw(db);
      this.logActivity(userId, username, "Xóa toàn bộ đi chợ", `Đã xóa tất cả ${removed} món khỏi danh sách đi chợ.`);
    }
    return removed;
  }

  // --- MEAL PLANNER DISH LIBRARY ---
  // Seeded from SEED_DISHES on first use; grows as AI suggests new dishes.
  public static getDishLibrary(): StoredDish[] {
    const db = this.readRaw();
    if (!db.dishLibrary) db.dishLibrary = [];
    // Top up any seed dishes (name+slot) the library is missing — so expanding
    // SEED_DISHES reaches existing installs without wiping AI-learned dishes.
    const known = new Set(db.dishLibrary.map(d => `${d.name.trim().toLowerCase()}|${d.slot}`));
    const now = new Date().toISOString();
    let added = 0;
    SEED_DISHES.forEach(d => {
      const key = `${d.name.trim().toLowerCase()}|${d.slot}`;
      if (known.has(key)) return;
      known.add(key);
      // Stable, collision-free id (don't reuse numeric indices that may clash
      // with existing dish_seed_N ids when topping up an older library).
      const slug = d.name
        .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      db.dishLibrary.push({
        id: `dish_seed_${d.slot}_${slug}`,
        name: d.name,
        slot: d.slot,
        ingredients: d.ingredients,
        source: "seed" as const,
        createdAt: now
      });
      added++;
    });
    if (added > 0) this.writeRaw(db);
    return db.dishLibrary;
  }

  // The single shared weekly menu shown on the shopping view.
  public static getMealPlan(): StoredMealPlan | null {
    return this.readRaw().mealPlan || null;
  }

  public static setMealPlan(plan: StoredMealPlan | null): void {
    const db = this.readRaw();
    db.mealPlan = plan;
    this.writeRaw(db);
  }

  // --- Lịch sử giá thị trường (BTC/ETH/Vàng/USD) cho sparkline ở Tổng quan ---

  public static getMarketHistory(): MarketHistoryPoint[] {
    return this.readRaw().marketHistory || [];
  }

  /**
   * Ghi một điểm giá mới. Bỏ qua nếu điểm gần nhất còn "tươi" (< minGapMs) để
   * nhiều client cùng mở app không làm phình dữ liệu. Tự cắt lịch sử > 30 ngày.
   */
  public static appendMarketHistory(
    point: Omit<MarketHistoryPoint, "id" | "at">,
    minGapMs = 9 * 60 * 1000
  ): boolean {
    // Không có số liệu nào thì khỏi ghi (upstream lỗi toàn bộ).
    if (point.btcUsd === null && point.ethUsd === null && point.goldSell === null && point.usdVnd === null) {
      return false;
    }
    const db = this.readRaw();
    if (!db.marketHistory) db.marketHistory = [];
    const last = db.marketHistory[db.marketHistory.length - 1];
    const now = Date.now();
    if (last && now - new Date(last.at).getTime() < minGapMs) return false;

    db.marketHistory.push({
      id: `mkt_${now}`,
      at: new Date(now).toISOString(),
      ...point
    });
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    db.marketHistory = db.marketHistory.filter(p => new Date(p.at).getTime() >= cutoff);
    this.writeRaw(db);
    return true;
  }

  // Add AI-suggested dishes, skipping ones already known (same name + slot).
  public static addDishesFromAI(
    dishes: { name: string; slot: DishSlot; ingredients: MealIngredient[] }[]
  ): number {
    const db = this.readRaw();
    if (!db.dishLibrary) db.dishLibrary = [];
    const known = new Set(db.dishLibrary.map(d => `${d.name.trim().toLowerCase()}|${d.slot}`));
    let added = 0;
    const now = new Date().toISOString();
    dishes.forEach((d, i) => {
      const name = (d.name || "").trim();
      if (!name) return;
      const key = `${name.toLowerCase()}|${d.slot}`;
      if (known.has(key)) return;
      known.add(key);
      db.dishLibrary.push({
        id: `dish_ai_${Date.now()}_${i}`,
        name,
        slot: d.slot,
        ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
        source: "ai",
        createdAt: now
      });
      added++;
    });
    if (added > 0) this.writeRaw(db);
    return added;
  }

  // --- MEDICATION REMINDERS ---
  public static saveMedication(data: Partial<MedicationReminder>, userId: string, username: string): MedicationReminder {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.name || !data.patientId || !data.times || data.times.length === 0) {
      throw new Error("Thiếu tên thuốc, người uống hoặc giờ nhắc");
    }

    if (data.id) {
      const idx = db.medications.findIndex(m => m.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy lịch thuốc");
      const updated = { ...db.medications[idx], ...data, updatedAt: now } as MedicationReminder;
      db.medications[idx] = updated;
      this.writeRaw(db);
      return updated;
    }

    const med: MedicationReminder = {
      id: `med_${Date.now()}`,
      name: data.name.trim(),
      dosage: data.dosage?.trim() || "",
      patientId: data.patientId,
      times: data.times.map(t => t.trim()).filter(Boolean),
      startDate: data.startDate || new Date().toISOString().slice(0, 10),
      endDate: data.endDate || undefined,
      notes: data.notes?.trim() || "",
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: now,
      updatedAt: now
    };
    db.medications.unshift(med);
    this.writeRaw(db);
    this.logActivity(userId, username, "Nhắc thuốc", `Đã tạo lịch thuốc "${med.name}".`);
    return med;
  }

  public static deleteMedication(id: string): void {
    const db = this.readRaw();
    db.medications = db.medications.filter(m => m.id !== id);
    // Dọn nhật ký liều của lịch thuốc đã xoá để tránh bản ghi mồ côi.
    db.medicationLogs = db.medicationLogs.filter(l => l.medicationId !== id);
    this.writeRaw(db);
  }

  // --- Nhật ký uống thuốc (adherence) ---
  // Trả về log gần đây (mặc định 30 ngày) để client hiển thị liều hôm nay + lịch sử ngắn.
  public static getMedicationLogs(sinceDate?: string): MedicationLog[] {
    const logs = this.readRaw().medicationLogs;
    if (!sinceDate) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      sinceDate = formatLocalDateTime(cutoff, false);
    }
    return logs.filter(l => l.date >= sinceDate!);
  }

  // Ghi nhận một liều. status "none" => xoá bản ghi (quay về chưa đánh dấu).
  // Định danh liều bởi (medicationId + date + time): bấm lại sẽ cập nhật, không tạo trùng.
  public static logMedicationDose(
    data: { medicationId?: string; date?: string; time?: string; status?: string; notes?: string },
    userId: string
  ): { log: MedicationLog | null; cleared: boolean } {
    const db = this.readRaw();
    const med = db.medications.find(m => m.id === data.medicationId);
    if (!med) throw new Error("Không tìm thấy lịch thuốc");
    if (!data.date || !data.time) throw new Error("Thiếu ngày hoặc giờ của liều thuốc");
    const status = data.status;
    if (status !== "taken" && status !== "skipped" && status !== "none") {
      throw new Error("Trạng thái liều thuốc không hợp lệ");
    }

    const idx = db.medicationLogs.findIndex(
      l => l.medicationId === data.medicationId && l.date === data.date && l.time === data.time
    );

    if (status === "none") {
      if (idx === -1) return { log: null, cleared: false };
      db.medicationLogs.splice(idx, 1);
      this.writeRaw(db);
      return { log: null, cleared: true };
    }

    const now = new Date().toISOString();
    if (idx !== -1) {
      const updated: MedicationLog = {
        ...db.medicationLogs[idx],
        status,
        loggedById: userId,
        loggedAt: now,
        notes: data.notes !== undefined ? data.notes : db.medicationLogs[idx].notes
      };
      db.medicationLogs[idx] = updated;
      this.writeRaw(db);
      return { log: updated, cleared: false };
    }

    const log: MedicationLog = {
      id: `medlog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      medicationId: med.id,
      patientId: med.patientId,
      date: data.date,
      time: data.time,
      status,
      loggedById: userId,
      loggedAt: now,
      notes: data.notes
    };
    db.medicationLogs.unshift(log);
    this.writeRaw(db);
    return { log, cleared: false };
  }

  // --- Kho giấy tờ gia đình ---
  public static getDocuments(): FamilyDocument[] {
    return this.readRaw().documents;
  }

  public static saveDocument(data: Partial<FamilyDocument>, userId: string, username: string): FamilyDocument {
    const db = this.readRaw();
    const now = new Date().toISOString();
    if (!data.title || !data.title.trim()) throw new Error("Thiếu tên giấy tờ");
    if (!data.type || !VALID_DOCUMENT_TYPES.has(data.type)) throw new Error("Loại giấy tờ không hợp lệ");

    const files = Array.isArray(data.files) ? data.files : [];

    if (data.id) {
      const idx = db.documents.findIndex(d => d.id === data.id);
      if (idx === -1) throw new Error("Không tìm thấy giấy tờ");
      const prev = db.documents[idx];
      // Xoá file đính kèm đã bị gỡ khỏi danh sách mới để không để lại rác trên đĩa.
      const newUrls = new Set(files.map(f => f.url));
      (prev.files || []).forEach(f => { if (!newUrls.has(f.url)) deleteMediaByUrl(f.url); });
      const updated: FamilyDocument = {
        ...prev,
        ...data,
        title: data.title.trim(),
        files,
        updatedAt: now
      } as FamilyDocument;
      db.documents[idx] = updated;
      this.writeRaw(db);
      this.logActivity(userId, username, "Giấy tờ", `Đã cập nhật giấy tờ "${updated.title}".`);
      return updated;
    }

    const doc: FamilyDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: data.type,
      title: data.title.trim(),
      ownerId: data.ownerId || undefined,
      documentNumber: data.documentNumber?.trim() || undefined,
      issuer: data.issuer?.trim() || undefined,
      issueDate: data.issueDate || undefined,
      expiryDate: data.expiryDate || undefined,
      notes: data.notes?.trim() || undefined,
      files,
      isShared: data.isShared !== undefined ? data.isShared : false,
      creatorId: userId,
      createdAt: now,
      updatedAt: now
    };
    db.documents.unshift(doc);
    this.writeRaw(db);
    this.logActivity(userId, username, "Giấy tờ", `Đã thêm giấy tờ "${doc.title}".`);
    return doc;
  }

  public static deleteDocument(id: string, userId: string, username: string): void {
    const db = this.readRaw();
    const doc = db.documents.find(d => d.id === id);
    if (!doc) return;
    // Dọn các tệp scan/ảnh đính kèm trên đĩa.
    (doc.files || []).forEach(f => deleteMediaByUrl(f.url));
    db.documents = db.documents.filter(d => d.id !== id);
    this.writeRaw(db);
    this.logActivity(userId, username, "Giấy tờ", `Đã xóa giấy tờ "${doc.title}".`);
  }

  // Pre-deadline reminders: notify before tasks are due and before plans start.
  // Deduplicated by notification id so each window fires only once.
  public static generateReminders(): void {
    const db = this.readRaw();
    const now = Date.now();
    let modified = false;

    const ensure = (id: string, userId: string, title: string, content: string, type: Notification["type"]) => {
      if (db.notifications.some(n => n.id === id)) return;
      const notif: Notification = { id, userId, title, content, type, isRead: false, createdAt: new Date().toISOString() };
      db.notifications.unshift(notif);
      void dispatchPush(db, notif, (dead) => this.removePushSubscriptionsByEndpoints(dead));
      modified = true;
    };
    const parse = (s: string): number | null => {
      if (!s) return null;
      const d = new Date(String(s).replace(" ", "T"));
      return isNaN(d.getTime()) ? null : d.getTime();
    };

    db.tasks.forEach(t => {
      if (t.status === "completed") return;
      const due = parse(t.dueDate);
      if (due === null) return;
      const diffMin = (due - now) / 60000;
      const recipient = t.assigneeId || "all";
      if (diffMin > 60 && diffMin <= 24 * 60) {
        ensure(`notif_taskdue1d_${t.id}`, recipient, "⏰ Sắp đến hạn công việc", `"${t.title}" đến hạn lúc ${t.dueDate}.`, "task");
      } else if (diffMin > 0 && diffMin <= 60) {
        ensure(`notif_taskdue1h_${t.id}`, recipient, "⏰ Công việc sắp đến hạn!", `"${t.title}" sẽ đến hạn trong vòng 1 giờ (${t.dueDate}).`, "task");
      } else if (diffMin <= 0) {
        ensure(`notif_taskoverdue_${t.id}`, recipient, "🔴 Công việc đã quá hạn", `"${t.title}" đã quá hạn (${t.dueDate}) mà chưa hoàn thành.`, "task");
      }
    });

    db.plans.forEach(p => {
      const start = parse(p.startDate);
      if (start === null) return;
      const diffMin = (start - now) / 60000;
      const recipient = p.isShared ? "all" : p.creatorId;
      if (diffMin > 60 && diffMin <= 24 * 60) {
        ensure(`notif_plansoon1d_${p.id}`, recipient, "📅 Sự kiện sắp diễn ra", `"${p.title}" bắt đầu lúc ${p.startDate}.`, "plan");
      } else if (diffMin > 0 && diffMin <= 60) {
        ensure(`notif_plansoon1h_${p.id}`, recipient, "📅 Sự kiện sắp bắt đầu!", `"${p.title}" sẽ bắt đầu trong vòng 1 giờ (${p.startDate}).`, "plan");
      }
    });

    // Nhắc hóa đơn định kỳ: trước 3 ngày → đúng ngày → quá hạn (quên bấm "đã trả").
    // Dedupe theo nextDueDate nên mỗi kỳ chỉ nhắc 1 lần cho mỗi mốc.
    const nowDate = new Date();
    const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    db.recurringBills.forEach(b => {
      if (!b.isActive) return;
      const p = String(b.nextDueDate || "").split("-");
      if (p.length < 3) return;
      const by = Number(p[0]), bm = Number(p[1]), bd = Number(p[2]);
      if (!by || !bm || !bd) return;
      const dueMidnight = new Date(by, bm - 1, bd).getTime();
      const diffDays = Math.round((dueMidnight - nowMidnight) / 86400000);
      const amt = b.amount.toLocaleString("vi-VN");
      if (diffDays > 0 && diffDays <= 3) {
        ensure(`notif_billdue_${b.id}_${b.nextDueDate}`, "all", "🧾 Hóa đơn sắp đến hạn", `"${b.title}" đến hạn ngày ${b.nextDueDate} (còn ${diffDays} ngày) — ${amt} đ.`, "finance");
      } else if (diffDays === 0) {
        ensure(`notif_billdue0_${b.id}_${b.nextDueDate}`, "all", "🧾 Hóa đơn đến hạn hôm nay", `"${b.title}" đến hạn thanh toán hôm nay — ${amt} đ.`, "finance");
      } else if (diffDays < 0) {
        ensure(`notif_billover_${b.id}_${b.nextDueDate}`, "all", "🔴 Hóa đơn đã quá hạn", `"${b.title}" quá hạn từ ${b.nextDueDate} — ${amt} đ. Đã trả rồi thì bấm "Đã trả" để dời sang kỳ sau nhé.`, "finance");
      }
    });

    const today = new Date();
    const todayKey = formatLocalDateTime(today, false);
    db.medications.forEach(m => {
      if (!m.isActive) return;
      if (m.startDate && todayKey < m.startDate) return;
      if (m.endDate && todayKey > m.endDate) return;
      const patient = db.users.find(u => u.id === m.patientId);
      m.times.forEach(time => {
        const reminderAt = parse(`${todayKey} ${time}`);
        if (reminderAt === null) return;
        const diffMin = (reminderAt - now) / 60000;
        if (diffMin > 0 && diffMin <= 60) {
          ensure(
            `notif_med_${m.id}_${todayKey}_${time.replace(":", "")}`,
            m.patientId || "all",
            "Den gio uong thuoc",
            `${patient?.fullName || "Thanh vien"} can uong ${m.name}${m.dosage ? ` (${m.dosage})` : ""} luc ${time}.`,
            "medication"
          );
        }
      });
    });

    // (Nhắc sinh nhật do generateBirthdayNotifications xử lý riêng — không lặp lại ở đây.)
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Nhắc giấy tờ hết hạn — gửi cho người lớn phụ trách (chủ sở hữu nếu là người lớn, ngược lại người tạo).
    // Dùng KHOẢNG ngày (không phải mốc đúng) để vẫn bắn dù cron lỡ đúng ngày; dedupe theo expiryDate.
    const adultIds = new Set(db.users.filter(u => u.role === "admin" || u.role === "member").map(u => u.id));
    db.documents.forEach(doc => {
      if (!doc.expiryDate) return;
      const p = String(doc.expiryDate).split("-");
      if (p.length < 3) return;
      const ey = Number(p[0]), em = Number(p[1]), ed = Number(p[2]);
      if (!ey || !em || !ed) return;
      const expiry = new Date(ey, em - 1, ed);
      const diffDays = Math.round((expiry.getTime() - todayMidnight.getTime()) / 86400000);
      const recipient = (doc.ownerId && adultIds.has(doc.ownerId)) ? doc.ownerId : doc.creatorId;
      if (!recipient) return;
      const exp = doc.expiryDate;
      const typeLabel = DOCUMENT_TYPE_LABELS[doc.type] || "Giấy tờ";
      if (diffDays > 7 && diffDays <= 30) {
        ensure(`notif_docexp30_${doc.id}_${exp}`, recipient, "📄 Giấy tờ sắp hết hạn", `"${doc.title}" (${typeLabel}) sẽ hết hạn ngày ${exp} — còn ${diffDays} ngày.`, "system");
      } else if (diffDays > 0 && diffDays <= 7) {
        ensure(`notif_docexp7_${doc.id}_${exp}`, recipient, "📄 Giấy tờ sắp hết hạn!", `"${doc.title}" (${typeLabel}) chỉ còn ${diffDays} ngày là hết hạn (${exp}).`, "system");
      } else if (diffDays === 0) {
        ensure(`notif_docexp0_${doc.id}_${exp}`, recipient, "📄 Giấy tờ hết hạn hôm nay", `"${doc.title}" (${typeLabel}) hết hạn hôm nay (${exp}).`, "system");
      } else if (diffDays < 0) {
        ensure(`notif_docexpover_${doc.id}_${exp}`, recipient, "🔴 Giấy tờ đã hết hạn", `"${doc.title}" (${typeLabel}) đã hết hạn từ ${exp}.`, "system");
      }
    });

    // Nhắc khoản nợ tới hạn (chưa tất toán & còn dư nợ). Gửi cho người tạo. Dedupe theo dueDate.
    db.debts.forEach(d => {
      if (d.isSettled || !d.dueDate) return;
      const remaining = d.amount - (d.payments || []).reduce((s, p) => s + p.amount, 0);
      if (remaining <= 0) return;
      const p = String(d.dueDate).split("-");
      if (p.length < 3) return;
      const y = Number(p[0]), m = Number(p[1]), dd = Number(p[2]);
      if (!y || !m || !dd) return;
      const due = new Date(y, m - 1, dd);
      const diffDays = Math.round((due.getTime() - todayMidnight.getTime()) / 86400000);
      const recipient = d.creatorId;
      if (!recipient) return;
      const verb = d.direction === "lent" ? "thu hồi" : "trả";
      const who = d.counterparty;
      const amt = remaining.toLocaleString();
      if (diffDays > 0 && diffDays <= 7) {
        ensure(`notif_debtdue7_${d.id}_${d.dueDate}`, recipient, "💸 Khoản nợ sắp đến hạn", `Còn ${diffDays} ngày đến hạn ${verb} ${amt}đ với "${who}".`, "finance");
      } else if (diffDays === 0) {
        ensure(`notif_debtdue0_${d.id}_${d.dueDate}`, recipient, "💸 Khoản nợ đến hạn hôm nay", `Hôm nay đến hạn ${verb} ${amt}đ với "${who}".`, "finance");
      } else if (diffDays < 0) {
        ensure(`notif_debtover_${d.id}_${d.dueDate}`, recipient, "🔴 Khoản nợ đã quá hạn", `Đã quá hạn ${verb} ${amt}đ với "${who}" (hẹn ${d.dueDate}).`, "finance");
      }
    });

    // Nhắc lịch tiêm chủng sắp tới (mũi chưa tiêm có ngày hẹn). Gửi cả nhà, dedupe theo ngày hẹn.
    db.vaccinations.forEach(v => {
      if (v.status !== "scheduled" || !v.scheduledDate) return;
      const p = String(v.scheduledDate).split("-");
      if (p.length < 3) return;
      const y = Number(p[0]), m = Number(p[1]), dd = Number(p[2]);
      if (!y || !m || !dd) return;
      const when = new Date(y, m - 1, dd);
      const diffDays = Math.round((when.getTime() - todayMidnight.getTime()) / 86400000);
      const child = db.users.find(u => u.id === v.childId);
      const childName = child?.fullName || "Bé";
      const dose = v.doseLabel ? ` (${v.doseLabel})` : "";
      if (diffDays > 0 && diffDays <= 7) {
        ensure(`notif_vacsoon_${v.id}_${v.scheduledDate}`, "all", "💉 Sắp đến lịch tiêm", `${childName} còn ${diffDays} ngày đến lịch tiêm "${v.name}"${dose} (${v.scheduledDate}).`, "medication");
      } else if (diffDays === 0) {
        ensure(`notif_vacday_${v.id}_${v.scheduledDate}`, "all", "💉 Hôm nay đến lịch tiêm", `${childName} có lịch tiêm "${v.name}"${dose} hôm nay.`, "medication");
      } else if (diffDays < 0) {
        ensure(`notif_vacover_${v.id}_${v.scheduledDate}`, "all", "🔴 Trễ lịch tiêm", `${childName} đã trễ lịch tiêm "${v.name}"${dose} (hẹn ${v.scheduledDate}).`, "medication");
      }
    });

    if (db.notifications.length > 200) {
      db.notifications = db.notifications.slice(0, 200);
    }
    if (modified) this.writeRaw(db);
  }

  // ---- Web Push subscriptions (one per device/browser) ----
  public static getPushSubscriptions(): PushSubscriptionRecord[] {
    return this.readRaw().pushSubscriptions;
  }

  // Upsert by endpoint so re-subscribing the same device never duplicates.
  public static addPushSubscription(
    userId: string,
    subscription: PushSubscriptionRecord["subscription"],
    userAgent?: string
  ): void {
    const endpoint = subscription?.endpoint;
    if (!endpoint) throw new Error("Đăng ký thông báo không hợp lệ (thiếu endpoint).");
    const db = this.readRaw();
    db.pushSubscriptions = db.pushSubscriptions.filter(s => s.endpoint !== endpoint);
    db.pushSubscriptions.unshift({
      id: `push_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userId,
      endpoint,
      subscription,
      userAgent: userAgent ? userAgent.slice(0, 200) : undefined,
      createdAt: new Date().toISOString()
    });
    this.writeRaw(db);
  }

  public static removePushSubscriptionByEndpoint(endpoint: string): void {
    if (!endpoint) return;
    const db = this.readRaw();
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter(s => s.endpoint !== endpoint);
    if (db.pushSubscriptions.length !== before) this.writeRaw(db);
  }

  // Bulk-remove expired/dead subscriptions reported by the push service (404/410).
  public static removePushSubscriptionsByEndpoints(endpoints: string[]): void {
    if (!endpoints || endpoints.length === 0) return;
    const db = this.readRaw();
    const dead = new Set(endpoints);
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter(s => !dead.has(s.endpoint));
    if (db.pushSubscriptions.length !== before) this.writeRaw(db);
  }

  // Manual person-to-person nudge: targeted in-app notification + push.
  // Excludes the sender's own devices (so a "cả nhà" broadcast doesn't buzz them).
  public static sendManualNotification(fromName: string, fromUserId: string, toUserId: string, message: string): void {
    const db = this.readRaw();
    const isBroadcast = toUserId === "all";
    const notif: Notification = {
      id: `notif_msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      userId: toUserId,
      title: isBroadcast ? `📣 ${fromName} nhắn cả nhà` : `📣 ${fromName} nhắc bạn`,
      content: message,
      type: "system",
      isRead: false,
      createdAt: new Date().toISOString()
    };
    db.notifications.unshift(notif);
    if (db.notifications.length > 200) {
      db.notifications = db.notifications.slice(0, 200);
    }
    void dispatchPush(db, notif, (dead) => this.removePushSubscriptionsByEndpoints(dead), fromUserId);
    this.writeRaw(db);
  }

  // Internal notification builder
  private static addNotificationInternal(db: FamilyOrganizerDB, userId: string, title: string, content: string, type: Notification["type"] = "system") {
    const newNotif: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      userId,
      title,
      content,
      type,
      isRead: false,
      createdAt: new Date().toISOString()
    };
    db.notifications.unshift(newNotif);
    // Keep max 200 notifications
    if (db.notifications.length > 200) {
      db.notifications = db.notifications.slice(0, 200);
    }
    // Deliver as a system push notification too (no-op if push unconfigured).
    void dispatchPush(db, newNotif, (dead) => this.removePushSubscriptionsByEndpoints(dead));
  }

  // Read notification status mark
  public static markNotificationRead(notifId: string, userId: string): void {
    const db = this.readRaw();
    const idx = db.notifications.findIndex(n => n.id === notifId);
    if (idx !== -1) {
      db.notifications[idx].isRead = true;
      this.writeRaw(db);
    }
  }

  public static markAllNotificationsRead(userId: string): void {
    const db = this.readRaw();
    let modified = false;
    db.notifications.forEach(n => {
      if ((n.userId === "all" || n.userId === userId) && !n.isRead) {
        n.isRead = true;
        modified = true;
      }
    });
    if (modified) {
      this.writeRaw(db);
    }
  }
}
