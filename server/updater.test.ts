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

  it("Immich: chỉ bật khi updater ≥ v2 báo có service Immich; so bản đang chạy với bản mới nhất", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/api/server/version") ? Response.json({ major: 1, minor: 130, patch: 2 }) : new Response("nf", { status: 404 })
      )
    );
    fs.mkdirSync(upd, { recursive: true });
    fs.writeFileSync(
      path.join(upd, "settings.json"),
      JSON.stringify({ immich: { latest: { version: "1.131.0", name: "v1.131.0", url: "u", publishedAt: "2026-10-01T00:00:00Z", breaking: true } } })
    );
    const m = await load();
    expect((await m.getImmichOverview()).status).toBe("updater_down");
    writeState({ heartbeat: now(), phase: "idle", script_version: 1 });
    expect((await m.getImmichOverview()).status).toBe("updater_old");
    writeState({ heartbeat: now(), phase: "idle", script_version: 2, immich: "" });
    expect((await m.getImmichOverview()).status).toBe("no_immich");
    await expect(m.startImmichUpdate()).rejects.toThrow(/không có Immich/);

    writeState({ heartbeat: now(), phase: "idle", script_version: 2, immich: "immich-server immich-machine-learning" });
    const ov = await m.getImmichOverview();
    expect(ov).toMatchObject({ status: "ready", services: ["immich-server", "immich-machine-learning"], updateAvailable: true });
    expect(ov.running.version).toBe("1.130.2");

    const r = await m.startImmichUpdate();
    expect(r.from).toBe("1.130.2");
    // Yêu cầu chỉ có action — danh sách service do updater quyết định, app không gửi.
    expect(parseEnv(fs.readFileSync(path.join(upd, "request.env"), "utf8"))).toEqual({ id: r.requestId, action: "immich" });
    await expect(m.startImmichUpdate()).rejects.toThrow(/chạy dở/);
  });

  it("trông chừng: đọc containers.txt + heal.log (mới nhất trước); quá 3 chu kỳ không ghi → số liệu cũ", async () => {
    writeState({ heartbeat: now(), phase: "idle", script_version: 3, watch_every: 60 });
    fs.writeFileSync(
      path.join(upd, "containers.txt"),
      `checked_at=${now()}\nc filebrowser homelab filebrowser running healthy ok\nc kidtube kidtube kidtube running - no_ports\nrác\n`
    );
    fs.writeFileSync(path.join(upd, "heal.log"), `${now() - 600} portainer no_network ok\n${now() - 60} kidtube no_ports failed\n`);
    const m = await load();
    const w = m.readContainers();
    expect(w.stale).toBe(false);
    expect(w.containers).toEqual([
      { name: "filebrowser", project: "homelab", service: "filebrowser", status: "running", health: "healthy", problem: "ok" },
      { name: "kidtube", project: "kidtube", service: "kidtube", status: "running", health: null, problem: "no_ports" }
    ]);
    expect(m.readHealEvents().map(e => [e.container, e.ok])).toEqual([["kidtube", false], ["portainer", true]]);
    fs.writeFileSync(path.join(upd, "containers.txt"), `checked_at=${now() - 600}\n`);
    expect(m.readContainers().stale).toBe(true);
  });

  it("báo Telegram lần tự sửa mới; lần đầu không báo dồn lịch sử; sửa hỏng chỉ báo 1 lần", async () => {
    const sent: string[] = [];
    vi.doMock("./telegramBackup.js", () => ({ notifyTelegram: async (t: string) => void sent.push(t) }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nf", { status: 404 })));
    writeState({ heartbeat: now(), phase: "idle", script_version: 3 });
    const heal = (line: string) => fs.appendFileSync(path.join(upd, "heal.log"), `${line}\n`);
    const m = await load();
    // Chưa có heal.log vẫn phải đặt mốc — nếu không, lần tự sửa thật đầu tiên bị coi là lịch sử.
    await m.runUpdateTick();
    heal(`${now() - 3600} portainer no_network ok`);
    await m.runUpdateTick();
    await new Promise(r => setTimeout(r, 20));
    expect(sent).toEqual([]);
    heal(`${now() + 1} filebrowser no_ports ok`);
    heal(`${now() + 2} kidtube start_failed failed`);
    await m.runUpdateTick();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatch(/filebrowser bị mất cổng — đã tự dựng lại/);
    expect(sent[0]).toMatch(/kidtube bị không khởi động được, tự dựng lại không được/);
    heal(`${now() + 3} kidtube start_failed failed`);
    await m.runUpdateTick();
    await new Promise(r => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
    vi.doUnmock("./telegramBackup.js");
  });

  it("khởi động lại app: chỉ app trong MANAGED_APPS của updater ≥ v3; yêu cầu chỉ gửi tên app", async () => {
    const m = await load();
    writeState({ heartbeat: now(), phase: "idle", script_version: 2 });
    expect(() => m.requestAppRestart("kidtube")).toThrow(/bản cũ/);
    writeState({ heartbeat: now(), phase: "idle", script_version: 3, apps: "car-rental kidtube" });
    expect(() => m.requestAppRestart("immich-server")).toThrow(/không quản lý/);
    expect(() => m.requestAppRestart("kid tube")).toThrow();
    const id = m.requestAppRestart("kidtube");
    expect(parseEnv(fs.readFileSync(path.join(upd, "request.env"), "utf8"))).toEqual({ id, action: "app_restart", app: "kidtube" });
  });

  it("app ở stack riêng: gọi API của app bằng HUB_TOKEN; chưa nhận khóa → báo cần cập nhật app; cài đúng bản admin chọn", async () => {
    vi.stubEnv("HUB_TOKEN", "t".repeat(64));
    vi.stubEnv("CAR_RENTAL_URL", "http://lan:3002/");
    vi.stubEnv("KIDTUBE_URL", "http://lan:8477");
    const calls: { url: string; method: string; auth: string | null; body: string | null }[] = [];
    let kidAuthOk = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const headers = (init.headers || {}) as Record<string, string>;
        calls.push({ url: String(url), method: init.method || "GET", auth: headers.Authorization ?? null, body: (init.body as string) ?? null });
        const u = new URL(String(url));
        if (u.pathname === "/api/health") return Response.json({ ok: true, version: u.port === "3002" ? "0.4.4" : "0.1.0" });
        if (u.port === "8477" && !kidAuthOk) return Response.json({ error: "Cần nhập PIN" }, { status: 401 });
        if (u.pathname === "/api/system/update")
          return Response.json({
            current: { version: "0.4.4" },
            updater: { alive: true, phase: "idle", result: "ok", message: "Đã lên v0.4.4", finishedAt: 1 },
            pending: null,
            log: "",
            available: { version: "0.4.5", name: "v0.4.5", notes: "- Sửa lỗi", url: "https://x" },
            lastCheckAt: 5,
            lastCheckError: null
          });
        if (u.pathname === "/api/admin/update")
          return Response.json({
            running: { version: "0.1.0", commitShort: "7565c22" },
            updater: { installed: true, online: true, phase: "idle", pendingRequest: false, repoOk: true, repoError: null },
            repo: { headShort: "7565c22", dirty: false, behind: 2, pending: [{ short: "a1", subject: "feat: x" }, { short: "b2", subject: "fix: y" }], checkedAt: "2026-10-31T00:00:00Z", fetchError: null },
            deployedCommit: "7565c22aaaa",
            lastRun: null,
            log: null,
            warnings: { activeKidSessions: 1, downloadRunning: false }
          });
        return Response.json({ ok: true });
      })
    );
    writeState({ heartbeat: now(), phase: "idle", script_version: 3, apps: "car-rental kidtube" });
    vi.resetModules();
    const apps = await import("./apps.js");

    const ov = await apps.getAppsOverview();
    const car = ov.apps.find(a => a.id === "car-rental")!;
    const kid = ov.apps.find(a => a.id === "kidtube")!;
    expect(car).toMatchObject({ control: "ok", canRestart: true, health: { ok: true, version: "0.4.4" } });
    expect(car.update).toMatchObject({ current: "0.4.4", available: { version: "0.4.5" }, busy: false, blockers: [] });
    expect(kid).toMatchObject({ control: "unauthorized", update: null, health: { ok: true } });
    expect(kid.controlError).toMatch(/HUB_TOKEN/);
    // Health công khai: không gửi khóa ra ngoài khi không cần.
    expect(calls.filter(c => c.url.endsWith("/api/health")).every(c => c.auth === null)).toBe(true);
    expect(calls.find(c => c.url === "http://lan:3002/api/system/update")?.auth).toBe(`Bearer ${"t".repeat(64)}`);

    kidAuthOk = true;
    const kidUpd = (await apps.getAppsOverview()).apps.find(a => a.id === "kidtube")!.update!;
    expect(kidUpd).toMatchObject({ current: "7565c22", available: { title: "2 thay đổi mới" } });
    expect(kidUpd.available!.commits).toHaveLength(2);
    expect(kidUpd.warnings[0]).toMatch(/1 bé đang xem/);

    await expect(apps.startAppUpdate("car-rental", "0.4.5")).resolves.toEqual({ target: "0.4.5" });
    const apply = calls.find(c => c.url.endsWith("/api/system/update/apply"))!;
    expect(apply).toMatchObject({ method: "POST" });
    expect(JSON.parse(apply.body!)).toEqual({ version: "0.4.5" });
    await expect(apps.startAppUpdate("car-rental", "bad")).rejects.toThrow(/không có bản mới/);
    await expect(apps.startAppUpdate("kidtube")).resolves.toEqual({ target: null });
    // POST không body → không gắn content-type JSON (Fastify từ chối JSON rỗng).
    const run = calls.find(c => c.url.endsWith("/api/admin/update/run"))!;
    expect(run.body).toBeNull();
    await expect(apps.startAppUpdate("immich")).rejects.toThrow(/Không có app/);

    expect(apps.restartApp("kidtube")).toBeTruthy();
    expect(parseEnv(fs.readFileSync(path.join(upd, "request.env"), "utf8"))).toMatchObject({ action: "app_restart", app: "kidtube" });
    vi.unstubAllEnvs();
  });
});
