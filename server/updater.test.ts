/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareVersions, parseEnv } from "./updater.js";

describe("compareVersions", () => {
  it("so số từng phần, không so chuỗi (1.10.0 > 1.9.0)", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });
});

describe("parseEnv", () => {
  it("đọc key=value, chịu CRLF và giá trị có dấu =", () => {
    expect(parseEnv("a=1\r\nmessage=x=y\n\nbad line\n")).toEqual({ a: "1", message: "x=y" });
  });
});

// Các ca dưới chạy module trong thư mục tạm (module tính data/ theo process.cwd()
// lúc import) để không đụng dữ liệu thật của máy dev.
describe("hộp thư với dịch vụ cập nhật", () => {
  const origCwd = process.cwd();
  let tmp = "";
  let upd = "";

  const writeState = (kv: Record<string, string | number>) => {
    fs.mkdirSync(upd, { recursive: true });
    fs.writeFileSync(path.join(upd, "state.env"), Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  };
  const now = () => Math.floor(Date.now() / 1000);
  const load = async () => {
    vi.resetModules();
    return import("./updater.js");
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fo-updater-"));
    upd = path.join(tmp, "data", "update");
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.0.0" }));
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(origCwd);
    vi.unstubAllGlobals();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* Windows: family.db còn mở trong tiến trình test — để OS tự dọn thư mục tạm */
    }
  });

  it("chưa có updater → không sống; nhịp tim cũ hơn 45s → coi như chết", async () => {
    const m = await load();
    expect(m.readUpdaterState()).toMatchObject({ alive: false, phase: "unknown" });
    writeState({ heartbeat: now() - 120, phase: "idle" });
    expect(m.readUpdaterState().alive).toBe(false);
    writeState({ heartbeat: now(), phase: "idle", request_id: "r1", result: "ok", finished_at: now() });
    expect(m.readUpdaterState()).toMatchObject({ alive: true, phase: "idle", requestId: "r1", result: "ok" });
  });

  it("khởi động lại: từ chối khi updater không chạy hoặc đang bận, ghi request.env khi rảnh", async () => {
    const m = await load();
    expect(() => m.requestRestart()).toThrow(/không chạy/);
    writeState({ heartbeat: now(), phase: "pulling" });
    expect(() => m.requestRestart()).toThrow(/chạy dở/);
    writeState({ heartbeat: now(), phase: "idle" });
    const id = m.requestRestart();
    const req = parseEnv(fs.readFileSync(path.join(upd, "request.env"), "utf8"));
    expect(req).toEqual({ id, action: "restart" });
    // Còn yêu cầu chưa được nhận → không ghi đè.
    expect(() => m.requestRestart()).toThrow(/chạy dở/);
  });

  it("bản mới = bản phát hành chính thức mới nhất lớn hơn bản đang chạy (bỏ qua bản thử nghiệm)", async () => {
    fs.mkdirSync(upd, { recursive: true });
    const rel = (version: string, prerelease = false) => ({ version, name: `v${version}`, notes: "", publishedAt: "2026-10-09T00:00:00Z", prerelease, url: "" });
    fs.writeFileSync(
      path.join(upd, "settings.json"),
      JSON.stringify({ releases: [rel("99.0.0-beta.1", true), rel("98.0.0"), rel("1.0.0"), rel("0.9.0")] })
    );
    const m = await load();
    expect(m.updateAvailable()?.version).toBe("98.0.0");
    const ov = m.getUpdateOverview();
    expect(ov.releases.find(r => r.version === "98.0.0")?.isNewer).toBe(true);
    expect(ov.releases.find(r => r.version === "1.0.0")?.isCurrent).toBe(true);
    expect(ov.releases.find(r => r.version === "0.9.0")?.isNewer).toBe(false);
  });

  it("cập nhật: chụp DB (.db.gz đọc lại được) rồi ghi yêu cầu kèm đường dẫn bản chụp", async () => {
    // GitHub không có script cho bản đích → updater giữ script hiện có.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    writeState({ heartbeat: now(), phase: "idle" });
    const m = await load();
    await expect(m.startUpdate(m.BUILD.version, { reason: "manual" })).rejects.toThrow(/rồi/);
    await expect(m.startUpdate("1.0", { reason: "manual" })).rejects.toThrow(/không hợp lệ/);

    const r = await m.startUpdate("99.0.0", { reason: "manual" });
    const req = parseEnv(fs.readFileSync(path.join(upd, "request.env"), "utf8"));
    expect(req).toMatchObject({ id: r.requestId, action: "update", target: "99.0.0", backup: `update/snapshots/${r.snapshot}` });
    expect(req.script).toBeUndefined();
    expect(req.restore).toBeUndefined();

    const gz = fs.readFileSync(path.join(tmp, "data", req.backup));
    expect(zlib.gunzipSync(gz).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(m.listSnapshots()).toHaveLength(1);
    expect(m.listSnapshots()[0]).toMatchObject({ from: m.BUILD.version, to: "99.0.0" });
    // Đang có yêu cầu chờ → không chạy lượt thứ hai.
    await expect(m.startUpdate("99.0.1", { reason: "manual" })).rejects.toThrow(/chạy dở/);
  });
});
