/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Tự động gửi backup toàn phần (.zip) qua Telegram bot — bản sao offsite miễn phí:
// Pi/SSD hỏng thì file backup vẫn nằm trong chat Telegram (lưu trên cloud Telegram).
//
// Cấu hình (Thiết lập → admin, lưu ở app_settings.json ngoài DB):
//   telegramBotToken   — token bot từ @BotFather
//   telegramChatId     — chat id nhận file (lấy từ @userinfobot)
//   telegramBackupEnabled — "1" = bật gửi tự động hằng đêm
//   telegramBackupLastSent — "YYYY-MM-DD" lần gửi thành công gần nhất (dedupe)
//
// Bot API giới hạn file 50MB — vượt trần thì báo lỗi rõ để người dùng biết
// chuyển sang tải tay (Thiết lập → Sao lưu toàn phần).

import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getAppSettings, setAppSetting } from "./db.js";
import { streamFullBackup, fullBackupFilename } from "./fullBackup.js";

const TELEGRAM_MAX_BYTES = 49 * 1024 * 1024; // chừa lề dưới trần 50MB của Bot API

// "YYYY-MM-DD" theo GIỜ ĐỊA PHƯƠNG của máy chủ — khung 2h–4h sáng VN nếu dùng
// toISOString (UTC) sẽ ra ngày hôm trước, hiển thị lệch gây khó hiểu.
const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface TelegramBackupStatus {
  configured: boolean;           // đã có token + chat id
  enabled: boolean;              // bật gửi backup hằng đêm
  weeklyDigestEnabled: boolean;  // bật bản tin tuần (sáng thứ Hai)
  maskedToken: string;           // "1234...ab" để hiển thị
  chatId: string;
  lastSent: string;              // "YYYY-MM-DD" hoặc ""
}

export function telegramBackupStatus(): TelegramBackupStatus {
  const s = getAppSettings();
  const token = s.telegramBotToken || "";
  return {
    configured: Boolean(token && s.telegramChatId),
    enabled: s.telegramBackupEnabled === "1",
    weeklyDigestEnabled: s.telegramWeeklyDigestEnabled === "1",
    maskedToken: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "",
    chatId: s.telegramChatId || "",
    lastSent: s.telegramBackupLastSent || ""
  };
}

/** Gửi tin nhắn văn bản (thông báo lỗi/thành công kèm file). Best-effort. */
async function sendTelegramText(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch { /* thông báo phụ — bỏ qua nếu lỗi */ }
}

/** Gửi một thông báo ngắn tới chat Telegram đã cấu hình (vd cập nhật app). Chưa cấu hình thì bỏ qua. */
export async function notifyTelegram(text: string): Promise<void> {
  const s = getAppSettings();
  if (!s.telegramBotToken || !s.telegramChatId) return;
  await sendTelegramText(s.telegramBotToken, s.telegramChatId, text);
}

/**
 * Đóng gói backup toàn phần ra file tạm rồi gửi qua Telegram sendDocument.
 * Trả về mô tả kết quả để hiển thị trong Thiết lập; ném Error khi thất bại.
 */
export async function sendBackupToTelegram(): Promise<{ sizeMb: number; fileName: string }> {
  const s = getAppSettings();
  const token = s.telegramBotToken || "";
  const chatId = s.telegramChatId || "";
  if (!token || !chatId) throw new Error("Chưa cấu hình Telegram bot token / chat ID.");

  // Nén ra file tạm (không dồn RAM) rồi đọc lên gửi.
  const tmpFile = path.join(os.tmpdir(), `fo-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.zip`);
  try {
    const out = fs.createWriteStream(tmpFile);
    // Đăng ký listener TRƯỚC khi nén — archive.pipe tự end stream khi xong,
    // attach sau có thể lỡ mất sự kiện close và treo vô hạn.
    const flushed = new Promise<void>((resolve, reject) => {
      out.on("close", () => resolve());
      out.on("error", reject);
    });
    await streamFullBackup(out);
    await flushed;

    const { size } = await fs.promises.stat(tmpFile);
    const sizeMb = Math.round((size / 1024 ** 2) * 10) / 10;
    if (size > TELEGRAM_MAX_BYTES) {
      throw new Error(`Backup ${sizeMb}MB vượt trần 50MB của Telegram — hãy tải backup thủ công trong Thiết lập.`);
    }

    const fileName = fullBackupFilename();
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", `🗄 Backup Family Organizer ${new Date().toLocaleString("vi-VN")} — ${sizeMb}MB`);
    form.append("document", new Blob([await fs.promises.readFile(tmpFile)], { type: "application/zip" }), fileName);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(`Telegram trả lỗi: ${data.description || `HTTP ${res.status}`}`);
    }

    setAppSetting("telegramBackupLastSent", localDateKey(new Date()));
    return { sizeMb, fileName };
  } finally {
    fs.promises.unlink(tmpFile).catch(() => { /* file tạm đã bị dọn */ });
  }
}

// ─── LỊCH GỬI TỰ ĐỘNG HẰNG ĐÊM ──────────────────────────────────────────────
// Kiểm tra mỗi 30 phút: đã bật + đủ cấu hình + đang trong khung 2h–4h sáng
// (giờ máy chủ) + hôm nay chưa gửi → gửi. Lỡ khung giờ (server tắt/updating)
// thì đêm sau gửi tiếp; lastSent chống gửi trùng trong cùng ngày.

let sending = false;

export async function runTelegramBackupTick(now = new Date()): Promise<void> {
  if (sending) return;
  const s = getAppSettings();
  if (s.telegramBackupEnabled !== "1" || !s.telegramBotToken || !s.telegramChatId) return;
  const hour = now.getHours();
  if (hour < 2 || hour >= 4) return;
  const todayKey = localDateKey(now);
  if (s.telegramBackupLastSent === todayKey) return;

  sending = true;
  try {
    const { sizeMb } = await sendBackupToTelegram();
    console.log(`Đã gửi backup tự động qua Telegram (${sizeMb}MB).`);
  } catch (e: any) {
    console.error("Gửi backup Telegram tự động thất bại:", e?.message || e);
    void sendTelegramText(s.telegramBotToken, s.telegramChatId, `⚠️ Backup tự động thất bại: ${e?.message || "lỗi không rõ"}`);
  } finally {
    sending = false;
  }
}
