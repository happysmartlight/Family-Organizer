/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Lock, User as UserIcon, Home, AlertCircle, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck, Sun, Moon, Languages, Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

interface AuthProps {
  onLoginSuccess: (user: any, token: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

// Các hạt sáng bay lên — sinh 1 lần ở module để vị trí ổn định giữa các lần render.
const PARTICLE_COLORS = ["bg-sky-300/50", "bg-indigo-300/50", "bg-emerald-300/45"];
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  left: Math.round((i / 30) * 100 + (i % 3) * 5) % 100,   // rải đều + lệch nhẹ
  size: 3 + (i % 5),                        // 3–7px, đa dạng kích thước
  delay: (i % 10) * 0.8,                    // lệch pha để không bay đồng loạt
  duration: 9 + (i % 7) * 1.8,              // 9–~20s
  drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 7),
  rise: 400 + (i % 6) * 90,                 // quãng đường bay lên
  color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
}));

// Trạng thái hoạt cảnh xác thực kiểu HUD.
type AuthPhase = "idle" | "scanning" | "verified" | "denied";
// Thời lượng quét tối thiểu (ms) để hoạt cảnh luôn kịp nhìn thấy dù server trả nhanh.
const MIN_SCAN_MS = 1100;

export function Auth({ onLoginSuccess, theme = "dark", onToggleTheme }: AuthProps) {
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const currentLang =
    SUPPORTED_LANGUAGES.find(
      (l) => l.code === (i18n.resolvedLanguage || i18n.language || "vi").split("-")[0]
    ) ?? SUPPORTED_LANGUAGES[0];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const [errorStatus, setErrorStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Hoạt cảnh "xác thực" kiểu HUD chạy suốt lần đăng nhập:
  //   scanning → (verified | denied). Cả thành công lẫn thất bại đều quét trước.
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<AuthPhase>("idle");
  const [hudError, setHudError] = useState("");
  const timers = useRef<number[]>([]);

  // Dọn timeout nếu component tháo giữa chừng (tránh gọi callback sau unmount).
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Giữ hoạt cảnh quét hiện tối thiểu MIN_SCAN_MS trước khi chốt kết quả.
  const afterMinScan = (startedAt: number, fn: () => void) => {
    const wait = Math.max(0, MIN_SCAN_MS - (Date.now() - startedAt));
    timers.current.push(window.setTimeout(fn, wait));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorStatus("");

    if (!username.trim() || !password) {
      setErrorStatus(t("auth.errorEmpty"));
      return;
    }

    setLoading(true);
    setHudError("");
    // Bật HUD quét ngay khi bấm (trừ khi người dùng tắt hiệu ứng chuyển động).
    if (!prefersReducedMotion) setPhase("scanning");
    const startedAt = Date.now();

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t("auth.errorInvalid"));
      }

      // Không hiệu ứng: vào thẳng app.
      if (prefersReducedMotion) {
        onLoginSuccess(data.user, data.token);
        return;
      }

      // Quét xong → tích ✓ → chuyển cảnh vào app.
      afterMinScan(startedAt, () => {
        setPhase("verified");
        try { navigator.vibrate?.(60); } catch { /* iOS PWA không hỗ trợ */ }
        timers.current.push(window.setTimeout(() => onLoginSuccess(data.user, data.token), 900));
      });
    } catch (err: any) {
      const msg = err?.message || t("auth.errorConnect");

      // Không hiệu ứng: hiện lỗi ngay trên form.
      if (prefersReducedMotion) {
        setErrorStatus(msg);
        setLoading(false);
        return;
      }

      // Quét xong → hiện ✗ đỏ kèm lý do → trả về form với lỗi.
      afterMinScan(startedAt, () => {
        setPhase("denied");
        setHudError(msg);
        try { navigator.vibrate?.([40, 70, 40]); } catch { /* iOS PWA không hỗ trợ */ }
        timers.current.push(window.setTimeout(() => {
          setPhase("idle");
          setLoading(false);
          setErrorStatus(msg);
        }, 1600));
      });
    }
  };

  // Cờ dẫn xuất cho lớp phủ HUD.
  const hudOpen = phase !== "idle";
  const scanning = phase === "scanning";
  const verified = phase === "verified";
  const denied = phase === "denied";
  // Tông màu: quét/thành công dùng sky→emerald, thất bại chuyển sang rose.
  const accentBorder = denied ? "border-rose-400/60" : "border-sky-400/60";

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-sky-200 selection:text-sky-700 font-sans" id="login-container">

      {/* Nền động: aurora xoay + quầng sáng trôi + hạt sáng bay lên + lưới mờ.
          Mask radial: gom sáng vào giữa (sau thẻ), mờ dần về mép để mép luôn sạch. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,#000_38%,transparent_75%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,#000_38%,transparent_75%)]"
      >
        {/* Vòng aurora gradient xoay chậm phía sau thẻ */}
        <motion.div
          className="absolute left-1/2 top-1/2 w-[42rem] h-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[100px]"
          style={{ background: "conic-gradient(from 0deg, rgba(14,165,233,0.35), rgba(99,102,241,0.30), rgba(16,185,129,0.25), rgba(168,85,247,0.28), rgba(14,165,233,0.35))" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 44, repeat: Infinity, ease: "linear" }}
        />

        {/* Quầng sáng trôi nhẹ + khẽ phập phồng */}
        <motion.div
          className="absolute -top-28 -left-24 w-96 h-96 rounded-full bg-sky-500/15 blur-[110px]"
          animate={{ y: [0, 30, 0], x: [0, 18, 0], scale: [1, 1.12, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/3 -right-24 w-[26rem] h-[26rem] rounded-full bg-indigo-500/15 blur-[120px]"
          animate={{ y: [0, -26, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-28 left-1/4 w-96 h-96 rounded-full bg-emerald-500/10 blur-[120px]"
          animate={{ y: [0, -18, 0], x: [0, -16, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Hạt sáng bay lên */}
        {PARTICLES.map((p, i) => (
          <motion.span
            key={i}
            className={`absolute bottom-0 rounded-full ${p.color}`}
            style={{ left: `${p.left}%`, width: p.size, height: p.size }}
            animate={{ y: [10, -p.rise], x: [0, p.drift, 0], opacity: [0, 0.9, 0] }}
            transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: "easeInOut" }}
          />
        ))}

        {/* Lưới mờ tinh tế */}
        <div className="absolute inset-0 opacity-[0.025] bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] bg-[size:46px_46px] text-slate-400" />
      </div>

      {/* Bộ chọn ngôn ngữ + nút đổi Sáng/Tối — góc trên phải, tôn trọng notch iPhone */}
      <div className="absolute right-4 top-[calc(env(safe-area-inset-top)_+_1rem)] z-20 flex items-center gap-2">
        {/* Bộ chọn ngôn ngữ */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={langOpen}
            aria-label={t("language.name")}
            title={t("language.name")}
            className="flex items-center gap-1.5 px-2.5 py-2 text-slate-400 hover:text-slate-100 bg-slate-900 neu-btn rounded-xl leading-none cursor-pointer group"
          >
            <span className="text-sm leading-none">{currentLang.flag}</span>
            <Languages className="w-4 h-4 transition-transform group-hover:scale-110" />
            <ChevronDown className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} />
          </button>

          {langOpen && (
            <>
              {/* Lớp phủ đóng menu khi bấm ra ngoài */}
              <div
                aria-hidden
                className="fixed inset-0 z-10"
                onClick={() => setLangOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                role="listbox"
                className="absolute right-0 mt-2 w-40 z-20 bg-slate-900 neu-raised rounded-xl p-1.5 space-y-0.5 shadow-xl shadow-black/40"
              >
                {SUPPORTED_LANGUAGES.map((l) => {
                  const active = l.code === currentLang.code;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        i18n.changeLanguage(l.code);
                        setLangOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        active
                          ? "bg-sky-500/15 text-sky-300"
                          : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                      }`}
                    >
                      <span className="text-base leading-none">{l.flag}</span>
                      <span className="flex-1 text-left">{l.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </div>

        {/* Nút đổi Sáng/Tối */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === "light" ? t("theme.toDark") : t("theme.toLight")}
            aria-label={theme === "light" ? t("theme.toDark") : t("theme.toLight")}
            className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-900 neu-btn rounded-xl leading-none cursor-pointer group flex items-center justify-center"
          >
            {theme === "light" ? (
              <Moon className="w-4.5 h-4.5 transition-transform group-hover:scale-110" />
            ) : (
              <Sun className="w-4.5 h-4.5 text-amber-500 transition-transform group-hover:rotate-45" />
            )}
          </button>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative w-full max-w-md bg-slate-900 neu-raised p-7 sm:p-8 rounded-[1.75rem] space-y-7 z-10"
      >
        {/* Logo + tiêu đề */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4 }}
          className="text-center space-y-3"
        >
          <div className="relative inline-flex">
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-sky-500/40 blur-xl" />
            <div className="relative inline-flex bg-gradient-to-br from-sky-500 to-indigo-500 p-3.5 rounded-2xl text-white leading-none shadow-lg shadow-sky-500/25">
              <Home className="w-8 h-8" />
            </div>
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-sky-400 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
              {t("auth.title")}
            </h2>
            <p className="text-slate-500 text-xs text-balance">{t("auth.subtitle")}</p>
          </div>
        </motion.div>

        {errorStatus && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-semibold flex items-center gap-2"
          >
            <AlertCircle className="w-4.5 h-4.5 shrink-0" />
            <span>{errorStatus}</span>
          </motion.div>
        )}

        {/* Biểu mẫu */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="text-slate-400 block font-semibold">{t("auth.usernameLabel")}</label>
            <div className="relative group">
              <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
              <input
                type="text"
                placeholder={t("auth.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="w-full bg-slate-950 neu-pressed-sm rounded-xl py-2.5 pl-10 pr-4 text-slate-200 outline-none transition-all focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-400 block font-semibold">{t("auth.passwordLabel")}</label>
            <div className="relative group">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
              <input
                type={showPwd ? "text" : "password"}
                placeholder={t("auth.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-slate-950 neu-pressed-sm rounded-xl py-2.5 pl-10 pr-11 text-slate-200 outline-none transition-all focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                tabIndex={-1}
                aria-label={showPwd ? t("auth.hidePassword") : t("auth.showPassword")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 rounded-lg transition-colors cursor-pointer"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group w-full bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white font-bold py-2.5 px-4 rounded-xl cursor-pointer select-none transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 text-xs"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("auth.submitting")}
              </>
            ) : (
              <>
                {t("auth.submit")}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

        {/* Chân trang: nhấn mạnh tính riêng tư của server gia đình */}
        <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" />
          {t("auth.footer")}
        </p>

        {/* Lớp phủ HUD "xác thực" — quét thẻ khi đăng nhập, kết bằng tích ✓ (thành công) hoặc ✗ (thất bại). */}
        <AnimatePresence>
          {hudOpen && (
            <motion.div
              key="hud"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0 z-30 rounded-[1.75rem] overflow-hidden bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center gap-6"
              role="status"
              aria-live="polite"
            >
              {/* Khung ngoặc 4 góc kiểu HUD */}
              {[
                "left-3 top-3 border-l-2 border-t-2 rounded-tl-lg",
                "right-3 top-3 border-r-2 border-t-2 rounded-tr-lg",
                "left-3 bottom-3 border-l-2 border-b-2 rounded-bl-lg",
                "right-3 bottom-3 border-r-2 border-b-2 rounded-br-lg",
              ].map((c, i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className={`absolute w-7 h-7 transition-colors duration-300 ${accentBorder} ${c}`}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.05 * i + 0.1, duration: 0.3 }}
                />
              ))}

              {/* Đường quét chạy dọc qua thẻ — chỉ khi đang quét */}
              {scanning && (
                <motion.div
                  aria-hidden
                  className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_14px_2px_rgba(56,189,248,0.75)]"
                  initial={{ top: "6%" }}
                  animate={{ top: ["6%", "94%", "6%"] }}
                  transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity }}
                />
              )}

              {/* Vòng HUD + biểu tượng trung tâm */}
              <div className="relative flex items-center justify-center w-36 h-36">
                {/* Vòng gạch xoay thuận */}
                <motion.div
                  aria-hidden
                  className={`absolute inset-0 rounded-full border-2 border-dashed transition-colors duration-300 ${denied ? "border-rose-400/40" : "border-sky-400/40"}`}
                  animate={{ rotate: 360 }}
                  transition={{ duration: denied ? 14 : 6, ease: "linear", repeat: Infinity }}
                />
                {/* Vòng mảnh xoay nghịch */}
                <motion.div
                  aria-hidden
                  className={`absolute inset-[0.9rem] rounded-full border transition-colors duration-300 ${denied ? "border-rose-400/30" : "border-indigo-400/30"}`}
                  animate={{ rotate: -360 }}
                  transition={{ duration: denied ? 16 : 8, ease: "linear", repeat: Infinity }}
                />
                {/* Cung sáng chạy nhanh — chỉ khi đang quét */}
                {scanning && (
                  <motion.svg
                    aria-hidden
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 100 100"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.4, ease: "linear", repeat: Infinity }}
                  >
                    <circle
                      cx="50" cy="50" r="46" fill="none"
                      stroke="rgba(56,189,248,0.9)" strokeWidth="2"
                      strokeLinecap="round" strokeDasharray="42 250"
                    />
                  </motion.svg>
                )}

                {/* Nhân trung tâm: logo (quét) → tích ✓ (thành công) / ✗ (thất bại) */}
                <motion.div
                  className={`relative flex items-center justify-center w-20 h-20 rounded-full shadow-lg transition-colors duration-300 ${
                    denied
                      ? "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/30"
                      : "bg-gradient-to-br from-sky-500 to-indigo-500 shadow-sky-500/30"
                  }`}
                  animate={verified || denied ? { scale: [1, 1.12, 1] } : {}}
                  transition={{ duration: 0.4 }}
                >
                  <div aria-hidden className={`absolute inset-0 rounded-full blur-lg ${denied ? "bg-rose-500/40" : "bg-sky-500/40"}`} />
                  <AnimatePresence mode="wait">
                    {verified ? (
                      <motion.svg
                        key="check"
                        className="relative w-9 h-9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        <motion.path
                          d="M4 12.5l5 5L20 6.5"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.45, ease: "easeOut" }}
                        />
                      </motion.svg>
                    ) : denied ? (
                      <motion.svg
                        key="cross"
                        className="relative w-9 h-9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        <motion.path
                          d="M6 6l12 12"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.25, ease: "easeOut" }}
                        />
                        <motion.path
                          d="M18 6L6 18"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.25, ease: "easeOut", delay: 0.2 }}
                        />
                      </motion.svg>
                    ) : (
                      <motion.span
                        key="home"
                        className="relative text-white"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                      >
                        <Home className="w-8 h-8" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* Trạng thái chữ + thanh tiến trình */}
              <div className="relative text-center space-y-2 px-6">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={phase}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, x: denied ? [0, -5, 5, -3, 3, 0] : 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className={`text-sm font-bold tracking-wide ${
                      denied ? "text-rose-300" : verified ? "text-emerald-300" : "text-sky-300"
                    }`}
                  >
                    {denied ? t("auth.failed") : verified ? t("auth.verified") : t("auth.verifying")}
                  </motion.p>
                </AnimatePresence>

                {/* Lý do thất bại (nếu có) */}
                <AnimatePresence>
                  {denied && hudError && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: 0.15 }}
                      className="text-[11px] text-rose-400/80 font-medium max-w-[15rem] mx-auto"
                    >
                      {hudError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="mx-auto h-1 w-40 rounded-full bg-slate-800 overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      denied
                        ? "bg-gradient-to-r from-rose-500 to-red-500"
                        : verified
                        ? "bg-gradient-to-r from-emerald-400 to-sky-400"
                        : "bg-gradient-to-r from-sky-400 to-indigo-400"
                    }`}
                    initial={{ width: "8%" }}
                    animate={{ width: verified || denied ? "100%" : "72%" }}
                    transition={{ duration: verified || denied ? 0.4 : 0.9, ease: "easeInOut" }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
