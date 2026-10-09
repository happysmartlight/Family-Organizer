/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Phiên bản app phía client: hỏi máy chủ đang chạy bản nào, chờ bản mới lên
// sau khi bấm cập nhật, và tải lại trang vào bản mới.
//
// Nguồn phát hiện bản mới là /api/version (không dựa vào service worker — iOS
// PWA hay giữ SW cũ rất lâu): so "dấu vân tay" version|commit|buildTime lúc
// trang nạp với lần hỏi sau.

import { reloadOnce, scheduleReloadFallback } from "./appReload.js";

export interface AppVersionInfo {
  version: string;
  commit: string;
  shortCommit?: string;
  buildTime: string;
  aiEnabled?: boolean;
  rewardsEnabled?: boolean;
  rewardApprovalThreshold?: number;
}

export const versionFingerprint = (v: Pick<AppVersionInfo, "version" | "commit" | "buildTime">) =>
  `${v.version}|${v.commit}|${v.buildTime}`;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("family_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAppVersion(): Promise<AppVersionInfo | null> {
  try {
    const res = await fetch("/api/version", { headers: authHeaders(), cache: "no-store" });
    return res.ok ? ((await res.json()) as AppVersionInfo) : null;
  } catch {
    return null;
  }
}

/** Chờ máy chủ phản hồi trở lại (sau khi khởi động lại). */
export async function waitForServer(timeoutMs = 2 * 60 * 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* đang khởi động lại */
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

/** Tải lại vào bản mới: kích hoạt SW mới nếu đang chờ, dọn cache cũ, rồi reload đúng một lần. */
export async function reloadIntoNewVersion(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => {});
      if (reg.waiting) {
        // controllerchange (ở App) sẽ reload; dự phòng nếu nó không bắn.
        reg.waiting.postMessage("SKIP_WAITING");
        scheduleReloadFallback(3000);
        return;
      }
    }
    const keys = await caches?.keys();
    await Promise.all((keys ?? []).map(k => caches.delete(k)));
  } catch {
    /* bỏ qua — reload vẫn lấy index.html mới (navigation network-first) */
  }
  reloadOnce();
}
