/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  CheckSquare,
  Calendar,
  FileText,
  TrendingDown,
  TrendingUp,
  Wallet,
  Activity,
  ArrowUpRight,
  AlertCircle,
  Cake,
  MapPin,
  AlertTriangle,
  Droplets,
  Wind,
  Sun,
  Moon,
  CloudRain,
  Waves
} from "lucide-react";
import { Task, FamilyPlan, Note, FinancialTransaction, User, TaskStatus, MarketHistoryPoint, CustomExpenseCategory } from "../types.js";
import { resolveCategory, catColor } from "../utils/expenseCategories.js";
import { motion, useReducedMotion } from "motion/react";
import { Avatar } from "./Avatar.js";
import { QuickNudge } from "./QuickNudge.js";
import { ShimmerLine, IconChip } from "./Lively.js";
import { getVietnamHolidaysForMonth } from "../utils/vietnamHolidays.js";
import { expandRecurringOccurrences } from "../utils/recurrence.js";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/index.js";

// Full Markdown (GFM) renderer — lazy-loaded, shared with the Notes tab so
// pinned-note previews render formatted content instead of raw text.
const MarkdownView = lazy(() => import("./Markdown.js"));
const MarkdownFallback = () => <p className="text-slate-600 text-[11px]">Đang hiển thị…</p>;

// Emoji + màu thanh + nhãn cho hạng mục CHI — lấy từ nguồn chân lý dùng chung
// (src/utils/expenseCategories.ts), bao gồm cả hạng mục mặc định lẫn hạng mục tự thêm.
const expenseCatMeta = (cat: string, custom: CustomExpenseCategory[] = []) => {
  const r = resolveCategory(cat || "other", custom);
  return { label: r.label, emoji: r.emoji, bar: catColor(r.color).bar };
};

interface DashboardProps {
  currentUser: User;
  users: User[];
  tasks: Task[];
  plans: FamilyPlan[];
  notes: Note[];
  transactions: FinancialTransaction[];
  customCategories?: CustomExpenseCategory[];
  activityLogs: any[];
  widgets: any;
  onViewPlan: (planId: string) => void;
  onNavigate: (tab: string) => void;
}

// WMO weather code → emoji (nhãn dịch qua i18n: dashboard.weather.codes.<code>)
const WEATHER_ICONS: Record<number, string> = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌧️", 61: "🌦️", 63: "🌧️", 65: "🌧️",
  80: "🌦️", 81: "🌧️", 82: "⛈️", 95: "⛈️", 96: "⛈️", 99: "⛈️"
};
const describeWeather = (code: number) => ({
  icon: WEATHER_ICONS[code] || "🌡️",
  label: i18n.t(`dashboard.weather.codes.${code}`, { defaultValue: "—" }),
});

// "cách đây" gọn gàng cho mốc thời gian động đất (nhận epoch ms từ USGS).
const timeAgoVi = (ms: number | null | undefined): string => {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return i18n.t("dashboard.timeAgoMin", { n: Math.max(1, mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return i18n.t("dashboard.timeAgoHour", { n: hours });
  const days = Math.round(hours / 24);
  return i18n.t("dashboard.timeAgoDay", { n: days });
};

// Aurora look of the hero banner per time of day. Blob tints are fixed accents
// at low opacity so they read as soft pastels on the light theme and as glow on dark.
const AURORA = {
  morning: {
    greetKey: "greetMorning",
    blobs: ["bg-amber-400/25", "bg-rose-400/20", "bg-orange-300/20"],
    nameGradient: "from-amber-500 via-rose-500 to-orange-500",
    shimmer: "via-amber-500/60",
    emblem: "sun"
  },
  afternoon: {
    greetKey: "greetAfternoon",
    blobs: ["bg-sky-500/20", "bg-cyan-400/20", "bg-violet-500/20"],
    nameGradient: "from-sky-500 via-violet-500 to-cyan-500",
    shimmer: "via-sky-500/60",
    emblem: "sun"
  },
  evening: {
    greetKey: "greetEvening",
    blobs: ["bg-violet-500/25", "bg-fuchsia-500/15", "bg-indigo-500/25"],
    nameGradient: "from-violet-500 via-fuchsia-500 to-sky-500",
    shimmer: "via-violet-500/60",
    emblem: "moon"
  }
} as const;

// Chọn lời chúc theo số thứ tự ngày trong năm → ổn định trong ngày, đổi mỗi ngày.
// Danh sách câu chúc nằm trong i18n (dashboard.greetings) để dịch được đa ngôn ngữ.
function greetingOfDay(d = new Date()): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86400000);
  const list = i18n.t("dashboard.greetings", { returnObjects: true }) as string[];
  if (!Array.isArray(list) || list.length === 0) return "";
  return list[dayOfYear % list.length];
}

// Biểu tượng thời gian trong ngày: mặt trời toả tia (xoay chậm) hoặc trăng + sao lấp lánh.
function TimeEmblem({ kind }: { kind: "sun" | "moon" }) {
  const reduce = useReducedMotion();
  if (kind === "moon") {
    return (
      <div className="relative w-10 h-10 grid place-items-center shrink-0">
        <div aria-hidden className="absolute inset-0 rounded-full bg-violet-400/25 blur-md" />
        <Moon className="relative w-6 h-6 text-violet-500 dark:text-violet-200 fill-violet-400/40" />
        {!reduce && (
          <motion.span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 text-amber-400 dark:text-amber-300 text-[10px] leading-none"
            animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1.15, 0.7] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            ✦
          </motion.span>
        )}
      </div>
    );
  }
  return (
    <div className="relative w-10 h-10 grid place-items-center shrink-0">
      <div aria-hidden className="absolute inset-0 rounded-full bg-amber-400/30 blur-md" />
      <motion.div
        className="relative"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={reduce ? undefined : { duration: 22, repeat: Infinity, ease: "linear" }}
      >
        <Sun className="w-6 h-6 text-amber-500 dark:text-amber-300" />
      </motion.div>
    </div>
  );
}

// Đồng hồ chạy thật — tách riêng để chỉ nó re-render mỗi giây, không kéo cả Dashboard.
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right leading-none">
      <div className="font-mono font-bold text-slate-100 tabular-nums text-lg md:text-xl">
        {now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
        <span className="text-[11px] font-semibold text-slate-400 ml-1 align-top">
          {now.toLocaleTimeString("vi-VN", { second: "2-digit" })}
        </span>
      </div>
      <div className="text-[10px] md:text-[11px] text-slate-300 mt-1 whitespace-nowrap">
        {now.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </div>
    </div>
  );
}

// Smoothly counts from the previous value up to the target (easeOutCubic).
function useCountUp(target: number | null | undefined, duration = 900): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (target === null || target === undefined || isNaN(target)) return;
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setDisplay(current);
      fromRef.current = current;
      if (t < 1) raf = requestAnimationFrame(tick);
      else { fromRef.current = target; setDisplay(target); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

// Renders a number that rolls up to its value once data arrives.
function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const display = useCountUp(value);
  return <>{format(display)}</>;
}

// Pulsing placeholder shown in a widget slot while its data is still loading.
const Skeleton = ({ className = "" }: { className?: string }) => (
  <span className={`inline-block bg-slate-700/40 rounded-md animate-pulse align-middle ${className}`} />
);

// Đường cong mượt (Catmull-Rom → cubic bézier) cho sparkline — thay nối thẳng gãy khúc.
function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// Sparkline + % tăng trưởng 7 ngày cho card giá (ẩn khi lịch sử chưa đủ 2 điểm).
function TrendRow({ values }: { values: number[] }) {
  const uid = React.useId();
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const up = last >= first;
  const pct = first !== 0 ? ((last - first) / first) * 100 : 0;
  const W = 120, H = 38, pad = 5;
  const min = Math.min(...values);
  const range = (Math.max(...values) - min) || 1;
  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (W - 2 * pad),
    y: H - pad - ((v - min) / range) * (H - 2 * pad),
  }));
  const line = smoothLine(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${H} L ${pts[0].x.toFixed(2)} ${H} Z`;
  const stroke = up ? "#34d399" : "#fb7185";
  const gid = `spark-${uid}`;
  const end = pts[pts.length - 1];
  return (
    <div className="space-y-0.5">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-7" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Chấm giá hiện tại — dựng bằng div nên không méo khi SVG giãn ngang */}
        <span
          className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(end.x / W) * 100}%`,
            top: `${(end.y / H) * 100}%`,
            backgroundColor: stroke,
            boxShadow: `0 0 0 3px ${stroke}30`,
          }}
        />
      </div>
      <p className={`text-[9px] font-mono ${up ? "text-emerald-400" : "text-rose-400"}`}>
        {up ? "▲" : "▼"} {pct >= 0 ? "+" : ""}{pct.toFixed(1).replace(".", ",")}% · {i18n.t("dashboard.spark7d")}
      </p>
    </div>
  );
}

export function Dashboard({
  currentUser,
  users,
  tasks,
  plans,
  notes,
  transactions,
  customCategories = [],
  activityLogs,
  widgets,
  onViewPlan,
  onNavigate
}: DashboardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // Entrance animation preset: cards slide up in sequence; plain fade when the
  // user prefers reduced motion.
  const fadeUp = (delay = 0) =>
    reduceMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay } }
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { type: "spring" as const, stiffness: 260, damping: 26, delay }
        };

  // Slow drift for the aurora blobs in the hero banner (disabled under reduced motion).
  const drift = (duration: number) =>
    reduceMotion
      ? {}
      : {
          animate: { x: [0, 24, -12, 0], y: [0, -18, 10, 0], scale: [1, 1.12, 0.94, 1] },
          transition: { duration, repeat: Infinity, ease: "easeInOut" as const }
        };

  // 1. Task calculations
  const myTasks = useMemo(() => {
    return tasks.filter(t => t.assigneeId === currentUser.id);
  }, [tasks, currentUser.id]);

  const urgentTasksCount = useMemo(() => {
    return tasks.filter(t => t.status !== TaskStatus.COMPLETED && t.priority === "high").length;
  }, [tasks]);

  const myRemainingTasks = useMemo(() => {
    return myTasks.filter(t => t.status !== TaskStatus.COMPLETED);
  }, [myTasks]);

  // 2. Financial calculations (this month)
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const financialSummary = useMemo(() => {
    let income = 0;
    let expense = 0;
    transactions.forEach(t => {
      if (t.date.startsWith(currentMonth)) {
        if (t.type === "income") income += t.amount;
        else expense += t.amount;
      }
    });
    return { income, expense, balance: income - expense };
  }, [transactions, currentMonth]);
  const balancePositive = financialSummary.balance >= 0;
  const financeTotal = financialSummary.income + financialSummary.expense;
  const incomePct = financeTotal > 0 ? (financialSummary.income / financeTotal) * 100 : 0;
  const expensePct = financeTotal > 0 ? (financialSummary.expense / financeTotal) * 100 : 0;

  // Top 3 hạng mục CHI tiêu đứng đầu của tháng hiện tại (kèm % trên tổng chi)
  const topExpenseCategories = useMemo(() => {
    const byCat = new Map<string, number>();
    transactions.forEach(t => {
      if (t.type === "expense" && t.date.startsWith(currentMonth)) {
        const key = t.category || "other";
        byCat.set(key, (byCat.get(key) || 0) + t.amount);
      }
    });
    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, amount]) => ({
        category,
        amount,
        pct: financialSummary.expense > 0 ? (amount / financialSummary.expense) * 100 : 0,
      }));
  }, [transactions, currentMonth, financialSummary.expense]);

  // 3. Sự kiện sắp diễn ra (30 ngày tới) — mở rộng cả sự kiện LẶP LẠI theo đúng
  // logic lịch (hằng ngày/tuần/tháng) và gộp thêm NGÀY LỄ, để khớp với lịch trình.
  const upcomingPlans = useMemo(() => {
    const WINDOW_DAYS = 20;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = new Date(startOfToday.getTime() + 86400000 * WINDOW_DAYS);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const fmtDate = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;

    type UpcomingItem = {
      key: string; planId: string; title: string; description: string; color: string;
      date: Date; dateLabel: string; timeLabel: string;
      isHoliday: boolean; recur: string;
    };
    const items: UpcomingItem[] = [];

    plans.forEach(plan => {
      const start = new Date(`${plan.startDate.slice(0, 10)}T00:00:00`);
      if (isNaN(start.getTime())) return;
      const timeLabel = (plan.startDate.split(" ")[1] || "").slice(0, 5);
      const recur = plan.isRecurring && plan.recurrenceType && plan.recurrenceType !== "none" ? plan.recurrenceType : "";

      const pushOcc = (day: Date) => {
        if (day < startOfToday || day > windowEnd) return;
        items.push({
          key: `${plan.id}-${day.getTime()}`,
          planId: plan.id,
          title: plan.title,
          description: plan.description || "",
          color: plan.color || "sky",
          date: day, dateLabel: fmtDate(day), timeLabel,
          isHoliday: false, recur
        });
      };

      if (recur) {
        // Logic mở rộng lặp lại dùng chung ở utils/recurrence (có test)
        expandRecurringOccurrences(plan, startOfToday, windowEnd).forEach(pushOcc);
      } else {
        pushOcc(start);
      }
    });

    // Ngày lễ trong khoảng cửa sổ (quét các tháng mà cửa sổ trải qua)
    const seenMonth = new Set<string>();
    const cm = new Date(startOfToday);
    while (cm <= windowEnd) {
      const mk = `${cm.getFullYear()}-${cm.getMonth()}`;
      if (!seenMonth.has(mk)) {
        seenMonth.add(mk);
        getVietnamHolidaysForMonth(cm.getFullYear(), cm.getMonth()).forEach(h => {
          const hd = new Date(`${h.date}T00:00:00`);
          if (isNaN(hd.getTime()) || hd < startOfToday || hd > windowEnd) return;
          items.push({
            key: `holiday-${h.date}`,
            planId: "",
            title: h.title,
            description: h.meaning || "",
            color: "holiday",
            date: hd, dateLabel: fmtDate(hd), timeLabel: "",
            isHoliday: true, recur: ""
          });
        });
      }
      cm.setMonth(cm.getMonth() + 1);
      cm.setDate(1);
    }

    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [plans]);

  // 4. Pinned notes
  const pinnedNotes = useMemo(() => {
    return notes.filter(n => n.isPinned).slice(0, 3);
  }, [notes]);

  // 5. Upcoming birthdays (next 30 days)
  const upcomingBirthdays = useMemo(() => {
    const today = new Date();
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return users
      .filter(u => u.dateOfBirth)
      .map(u => {
        const dob = new Date(u.dateOfBirth as string);
        if (isNaN(dob.getTime())) return null;
        let bday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (bday.getTime() < todayMid) {
          bday = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
        }
        const daysUntil = Math.round((bday.getTime() - todayMid) / 86400000);
        return {
          user: u,
          daysUntil,
          turningAge: bday.getFullYear() - dob.getFullYear(),
          month: dob.getMonth() + 1,
          day: dob.getDate()
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [users]);

  // 6. Đếm ngược sự kiện lớn: ngày lễ sắp tới + sinh nhật gần nhất + sự kiện
  // "Quan trọng" (một lần, chưa qua). Hiển thị 4 mục gần nhất dạng "Còn X ngày".
  const countdowns = useMemo(() => {
    const today = new Date();
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const daysTo = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMid) / 86400000);
    const fmt = (d: Date) => d.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" });

    type CountdownItem = { key: string; icon: string; title: string; daysUntil: number; dateLabel: string; accent: string };
    const items: CountdownItem[] = [];

    // Ngày lễ trong ~13 tháng tới (đảm bảo luôn bắt được Tết kế tiếp)
    for (let off = 0; off < 13; off++) {
      const m = new Date(today.getFullYear(), today.getMonth() + off, 1);
      getVietnamHolidaysForMonth(m.getFullYear(), m.getMonth()).forEach(h => {
        const hd = new Date(`${h.date}T00:00:00`);
        const days = daysTo(hd);
        if (isNaN(hd.getTime()) || days < 0) return;
        items.push({ key: `h-${h.date}`, icon: "🎉", title: h.shortTitle, daysUntil: days, dateLabel: fmt(hd), accent: "amber" });
      });
    }

    // Sinh nhật gần nhất của mỗi thành viên (không giới hạn 30 ngày)
    users.forEach(u => {
      if (!u.dateOfBirth) return;
      const dob = new Date(u.dateOfBirth);
      if (isNaN(dob.getTime())) return;
      let bd = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      if (bd.getTime() < todayMid) bd = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      items.push({ key: `b-${u.id}`, icon: "🎂", title: i18n.t("dashboard.birthdayCountdown", { name: u.fullName }), daysUntil: daysTo(bd), dateLabel: fmt(bd), accent: "pink" });
    });

    // Sự kiện đánh dấu "Quan trọng" (một lần) chưa diễn ra
    plans.forEach(p => {
      if (p.color !== "rose" || p.isRecurring) return;
      const d = new Date(`${p.startDate.slice(0, 10)}T00:00:00`);
      const days = daysTo(d);
      if (isNaN(d.getTime()) || days < 0) return;
      items.push({ key: `p-${p.id}`, icon: "⭐", title: p.title, daysUntil: days, dateLabel: fmt(d), accent: "rose" });
    });

    return items.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);
  }, [users, plans, i18n.language]);

  // Time of day drives both the greeting and the hero's aurora palette.
  const aurora = useMemo(() => {
    const hours = new Date().getHours();
    if (hours >= 5 && hours < 12) return AURORA.morning;
    if (hours >= 12 && hours < 18) return AURORA.afternoon;
    return AURORA.evening;
  }, []);
  // Lời chúc gia đình đổi theo ngày (ổn định trong phiên; đổi lại khi đổi ngôn ngữ).
  const dailyGreeting = useMemo(() => greetingOfDay(), [i18n.language]);

  // Chuỗi giá 7 ngày cho sparkline từng card (server chụp ~10 phút/lần).
  const marketSeries = useMemo(() => {
    const history: MarketHistoryPoint[] = widgets?.history || [];
    const pick = (key: "btcUsd" | "ethUsd" | "goldSell" | "usdVnd") =>
      history.map(p => p[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return { btc: pick("btcUsd"), eth: pick("ethUsd"), gold: pick("goldSell"), fx: pick("usdVnd") };
  }, [widgets?.history]);

  // Widget formatting helpers
  const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const fmtVnd = (n: number) => Math.round(n).toLocaleString("vi-VN") + "đ";
  const changeBadge = (pct: number | null | undefined) => {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    const up = pct >= 0;
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${up ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
      </span>
    );
  };

  return (
    <div className="space-y-6" id="dashboard-tab">
      {/* Greetings Block — aurora hero that shifts palette with the time of day */}
      <motion.div
        {...fadeUp(0)}
        className="relative overflow-hidden bg-slate-900 neu-raised-lg rounded-2xl"
        id="dashboard-header-banner"
      >
        {/* Aurora backdrop: three drifting blurred blobs + twinkling sparkles */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <motion.div {...drift(16)} className={`absolute -top-24 -left-16 w-64 h-64 rounded-full blur-3xl ${aurora.blobs[0]}`} />
          <motion.div {...drift(21)} className={`absolute -top-16 right-0 w-72 h-72 rounded-full blur-3xl ${aurora.blobs[1]}`} />
          <motion.div {...drift(26)} className={`absolute -bottom-28 left-1/3 w-72 h-72 rounded-full blur-3xl ${aurora.blobs[2]}`} />
          {!reduceMotion &&
            [
              { top: "18%", left: "38%", delay: 0 },
              { top: "62%", left: "56%", delay: 1.6 },
              { top: "28%", left: "82%", delay: 0.8 }
            ].map((s, i) => (
              <motion.span
                key={i}
                className="absolute text-slate-100/50 text-[10px] select-none"
                style={{ top: s.top, left: s.left }}
                animate={{ opacity: [0.1, 0.8, 0.1], scale: [0.7, 1.15, 0.7] }}
                transition={{ duration: 3.6, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
              >
                ✦
              </motion.span>
            ))}
        </div>
        <ShimmerLine via={aurora.shimmer} />

        <div className="relative p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              {/* Quầng sáng aurora theo buổi ôm quanh avatar */}
              <div aria-hidden className={`absolute -inset-1.5 rounded-2xl blur-md opacity-50 bg-gradient-to-br ${aurora.nameGradient}`} />
              <Avatar
                user={currentUser}
                className="relative w-12 h-12 md:w-14 md:h-14 rounded-2xl text-lg"
                extraClass="ring-2 ring-slate-100/10 shadow-lg"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-100 truncate">
                {t("dashboard.greetPrefix")}{" "}
                <span className={`bg-gradient-to-r ${aurora.nameGradient} bg-clip-text text-transparent`}>
                  {currentUser.fullName}
                </span>
                !
              </h2>
              <p className="text-slate-300 text-sm md:text-base">
                <span className="font-semibold text-slate-200">{t(`dashboard.${aurora.greetKey}`)}</span> {dailyGreeting}
              </p>
            </div>
          </div>
          <div className="self-start md:self-auto shrink-0 flex items-center gap-3 bg-slate-950/50 backdrop-blur-md px-4 py-2.5 rounded-2xl neu-pressed-sm">
            <TimeEmblem kind={aurora.emblem} />
            <LiveClock />
          </div>
        </div>
      </motion.div>

      {/* Đếm ngược sự kiện lớn (lễ / sinh nhật / sự kiện Quan trọng) */}
      {countdowns.length > 0 && (
        <motion.div {...fadeUp(0.09)} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6" id="dashboard-countdowns">
          {countdowns.map(c => {
            const accentMap: Record<string, { text: string; bg: string }> = {
              amber: { text: "text-amber-400", bg: "from-amber-500/12" },
              pink: { text: "text-pink-400", bg: "from-pink-500/12" },
              rose: { text: "text-rose-400", bg: "from-rose-500/12" }
            };
            const a = accentMap[c.accent] || accentMap.amber;
            return (
              <div key={c.key} className={`relative overflow-hidden bg-gradient-to-br ${a.bg} via-slate-900 to-slate-900 neu-raised rounded-2xl px-3.5 py-3 flex items-center gap-3`}>
                <span className="text-2xl leading-none shrink-0">{c.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-300 truncate" title={c.title}>{c.title}</p>
                  <p className={`text-sm font-extrabold ${a.text} leading-tight`}>
                    {c.daysUntil === 0 ? t("dashboard.countdown.today") : t("dashboard.countdown.inDays", { n: c.daysUntil })}
                    <span className="text-[10px] font-mono font-medium text-slate-500 ml-1.5">{c.dateLabel}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Weather + Markets widgets — always rendered (skeleton while loading) to avoid layout shift */}
      <motion.div {...fadeUp(0.12)} className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6" id="dashboard-widgets">

        {/* Weather */}
        {(() => {
          const w = widgets?.weather;
          const hasW = !!w?.current;
          const cur = hasW ? describeWeather(w.current.weather_code) : null;
          const uvToday = hasW && w.daily?.uv_index_max ? w.daily.uv_index_max[0] : null;
          const rainToday = hasW && w.daily?.precipitation_probability_max ? w.daily.precipitation_probability_max[0] : null;
          const storm = w?.stormRisk;
          // Văn bản cảnh báo giông bão dịch qua i18n (server chỉ trả dữ liệu có cấu trúc).
          // Dự phòng cả payload cũ (có label/detail) để không hiện khoá thô khi cache cũ.
          const stormHasType = !!storm && typeof storm.type === "string" && storm.type !== "none";
          const stormLabel = stormHasType
            ? t(`dashboard.weather.storm.${storm.type}`)
            : (storm?.label || "");
          const stormDetail = stormHasType
            ? storm.type === "typhoon"
              ? t("dashboard.weather.storm.gustTyphoon", { gust: storm.gust })
              : storm.type === "wind"
                ? t("dashboard.weather.storm.gustWind", { gust: storm.gust })
                : storm.thunderNow
                  ? t("dashboard.weather.storm.thunderNow")
                  : t("dashboard.weather.storm.heavyRain", { rain: storm.rain })
            : (storm?.detail || "");
          const quakes = widgets?.quakes;
          const quakeList: any[] = quakes?.events || [];
          const stormStyle = storm?.level === "warning"
            ? "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300"
            : "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300";
          return (
            <div className="relative overflow-hidden lg:col-span-1 bg-gradient-to-br from-sky-500/15 via-slate-900 to-slate-900 neu-raised rounded-2xl p-4 shadow-lg flex flex-col min-h-[168px]">
              <ShimmerLine via="via-sky-500/60" />
              <div aria-hidden className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.sky.500/0.18),transparent_65%)] pointer-events-none" />

              {/* Địa phương (đổi trong Thiết lập → Hồ sơ của tôi) */}
              <div className="relative flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <p className="text-xs text-slate-400 font-semibold truncate">{hasW ? w.city : t("dashboard.weather.title")}</p>
              </div>

              <div className="relative flex items-start justify-between">
                <div className="min-w-0">
                  {hasW ? (
                    <p className="text-2xl font-extrabold text-slate-100 mt-0.5">
                      <AnimatedNumber value={w.current.temperature_2m} format={(n) => `${Math.round(n)}°C`} />
                    </p>
                  ) : (
                    <Skeleton className="h-8 w-24 mt-1.5" />
                  )}
                  {hasW ? (
                    <p className="text-xs text-slate-400 mt-0.5">{cur!.label} • {t("dashboard.weather.feelsLike")} {Math.round(w.current.apparent_temperature)}°</p>
                  ) : (
                    <Skeleton className="h-3 w-32 mt-2" />
                  )}
                </div>
                <span className="text-3xl leading-none">{hasW ? cur!.icon : "🌡️"}</span>
              </div>

              {/* Chi tiết: độ ẩm, gió giật, tia UV, xác suất mưa */}
              <div className="relative grid grid-cols-2 gap-1.5 mt-2.5 pt-2.5 border-t border-slate-800/60 text-[11px] text-slate-300">
                {hasW ? (
                  <>
                    <span className="inline-flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5 text-sky-400 shrink-0" />{t("dashboard.weather.humidity")} {w.current.relative_humidity_2m}%</span>
                    <span className="inline-flex items-center gap-1.5"><Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />{t("dashboard.weather.gust")} {Math.round(w.current.wind_gusts_10m ?? w.current.wind_speed_10m)} km/h</span>
                    {uvToday != null && <span className="inline-flex items-center gap-1.5"><Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />{t("dashboard.weather.uv")} {Math.round(uvToday)}</span>}
                    {rainToday != null && <span className="inline-flex items-center gap-1.5"><CloudRain className="w-3.5 h-3.5 text-indigo-400 shrink-0" />{t("dashboard.weather.rain")} {Math.round(rainToday)}%</span>}
                  </>
                ) : (
                  <Skeleton className="h-3 w-40 col-span-2" />
                )}
              </div>

              {/* Cảnh báo nguy cơ giông bão (ước lượng từ gió giật + mã dông) */}
              {hasW && storm && storm.level !== "none" && (
                <div className={`relative mt-2.5 rounded-lg border px-2.5 py-1.5 flex items-start gap-2 ${stormStyle}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold leading-tight">{stormLabel}</p>
                    {stormDetail && <p className="text-[10px] opacity-80 leading-tight mt-0.5">{stormDetail} · {t("dashboard.weather.estimate")}</p>}
                  </div>
                </div>
              )}

              <div className="relative flex justify-between mt-2.5 gap-2">
                {hasW && w.daily?.time ? (
                  w.daily.time.slice(0, 3).map((d: string, i: number) => {
                    const dc = describeWeather(w.daily.weather_code[i]);
                    const dayLabel = i === 0 ? t("dashboard.weather.today") : new Date(d).toLocaleDateString(i18n.language, { weekday: "short" });
                    return (
                      <div key={d} className="flex-1 text-center bg-slate-950/40 backdrop-blur-sm rounded-lg py-1.5 hover:bg-slate-950/60 transition-colors">
                        <p className="text-[10px] text-slate-500">{dayLabel}</p>
                        <p className="text-base leading-tight">{dc.icon}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{Math.round(w.daily.temperature_2m_min[i])}°/{Math.round(w.daily.temperature_2m_max[i])}°</p>
                      </div>
                    );
                  })
                ) : (
                  [0, 1, 2].map(i => (
                    <div key={i} className="flex-1 bg-slate-950/40 rounded-lg py-2 flex flex-col items-center gap-1.5">
                      <Skeleton className="h-2 w-8" />
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-2 w-9" />
                    </div>
                  ))
                )}
              </div>

              {/* Động đất gần đây trong bán kính quanh địa phương (USGS) */}
              <div className="relative mt-2.5 pt-2.5 border-t border-slate-800/60">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wide mb-1">
                  <Waves className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  {t("dashboard.weather.quakeTitle")} {quakes?.radiusKm ? t("dashboard.weather.quakeRadius", { km: quakes.radiusKm }) : ""}
                </div>
                {quakeList.length > 0 ? (
                  <div className="space-y-1">
                    {quakeList.slice(0, 2).map((q, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className={`font-mono font-bold shrink-0 ${q.mag >= 5 ? "text-rose-400" : q.mag >= 4 ? "text-amber-400" : "text-slate-300"}`}>M{Number(q.mag).toFixed(1)}</span>
                        <span className="text-slate-400 truncate min-w-0 flex-1">{q.distanceKm != null ? t("dashboard.weather.quakeAway", { km: q.distanceKm }) : t("dashboard.weather.quakeRecent")} · {timeAgoVi(q.time)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">{t("dashboard.weather.noQuake")}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Chỉ số nhanh + Thị trường — 8 card cùng kích thước, cạnh thời tiết cho gọn trang */}
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 auto-rows-fr">
          {/* Bitcoin */}
          <div className="relative overflow-hidden bg-gradient-to-br from-amber-500/12 via-slate-900 to-slate-900 neu-raised rounded-2xl p-4 hover:-translate-y-0.5 transition-transform duration-300 flex flex-col justify-between">
            <ShimmerLine via="via-amber-500/50" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">₿ Bitcoin</span>
              {widgets?.crypto?.bitcoin ? changeBadge(widgets.crypto.bitcoin.usd_24h_change) : null}
            </div>
            <div className="mt-3">
              <div className="min-w-0">
                {widgets?.crypto?.bitcoin ? (
                  <>
                    <p className="text-xl font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.crypto.bitcoin.usd} format={fmtUsd} /></p>
                    <p className="text-[11px] text-slate-500 font-mono truncate"><AnimatedNumber value={widgets.crypto.bitcoin.vnd} format={fmtVnd} /></p>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-2.5 w-20 mt-1.5" />
                  </>
                )}
              </div>
              <div className="w-full mt-1"><TrendRow values={marketSeries.btc} /></div>
            </div>
          </div>

          {/* Ethereum */}
          <div className="relative overflow-hidden bg-gradient-to-br from-indigo-500/12 via-slate-900 to-slate-900 neu-raised rounded-2xl p-4 hover:-translate-y-0.5 transition-transform duration-300 flex flex-col justify-between">
            <ShimmerLine via="via-indigo-500/50" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-400">Ξ Ethereum</span>
              {widgets?.crypto?.ethereum ? changeBadge(widgets.crypto.ethereum.usd_24h_change) : null}
            </div>
            <div className="mt-3">
              <div className="min-w-0">
                {widgets?.crypto?.ethereum ? (
                  <>
                    <p className="text-xl font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.crypto.ethereum.usd} format={fmtUsd} /></p>
                    <p className="text-[11px] text-slate-500 font-mono truncate"><AnimatedNumber value={widgets.crypto.ethereum.vnd} format={fmtVnd} /></p>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-2.5 w-20 mt-1.5" />
                  </>
                )}
              </div>
              <div className="w-full mt-1"><TrendRow values={marketSeries.eth} /></div>
            </div>
          </div>

          {/* Gold */}
          <div className="relative overflow-hidden bg-gradient-to-br from-yellow-500/12 via-slate-900 to-slate-900 neu-raised rounded-2xl p-4 hover:-translate-y-0.5 transition-transform duration-300 flex flex-col justify-between">
            <ShimmerLine via="via-yellow-500/50" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-yellow-500">🪙 {widgets?.gold?.source || t("dashboard.market.gold")}</span>
              {widgets?.gold ? changeBadge(widgets.gold.changePct) : null}
            </div>
            <div className="mt-3">
              <div className="min-w-0">
                {widgets?.gold && (widgets.gold.sell || widgets.gold.vndPerTael || widgets.gold.usdPerOz) ? (
                  widgets.gold.sell ? (
                    <>
                      <p className="text-lg font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.gold.sell} format={fmtVnd} /></p>
                      <p className="text-[11px] text-slate-500 truncate">{t("dashboard.market.goldSell")}{widgets.gold.buy ? ` • ${t("dashboard.market.goldBuy")} ${fmtVnd(widgets.gold.buy)}` : ""}</p>
                    </>
                  ) : widgets.gold.vndPerTael ? (
                    <>
                      <p className="text-lg font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.gold.vndPerTael} format={fmtVnd} /></p>
                      <p className="text-[11px] text-slate-500 truncate">{t("dashboard.market.goldTael")}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.gold.usdPerOz} format={fmtUsd} /><span className="text-[11px] text-slate-500"> /oz</span></p>
                      <p className="text-[11px] text-slate-500 truncate">{t("dashboard.market.goldWorld")}</p>
                    </>
                  )
                ) : (
                  <>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-2.5 w-20 mt-1.5" />
                  </>
                )}
              </div>
              <div className="w-full mt-1"><TrendRow values={marketSeries.gold} /></div>
            </div>
          </div>

          {/* USD/VND */}
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500/12 via-slate-900 to-slate-900 neu-raised rounded-2xl p-4 hover:-translate-y-0.5 transition-transform duration-300 flex flex-col justify-between">
            <ShimmerLine via="via-emerald-500/50" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400">💵 USD/VND</span>
            </div>
            <div className="mt-3">
              <div className="min-w-0">
                {widgets?.fx?.usdVnd ? (
                  <>
                    <p className="text-xl font-extrabold text-slate-100 leading-tight"><AnimatedNumber value={widgets.fx.usdVnd} format={fmtVnd} /></p>
                    <p className="text-[11px] text-slate-500 truncate">{t("dashboard.market.usdRate")}</p>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-2.5 w-20 mt-1.5" />
                  </>
                )}
              </div>
              <div className="w-full mt-1"><TrendRow values={marketSeries.fx} /></div>
            </div>
          </div>

          {/* Card 1: Cash balance this month */}
          <motion.div
            {...fadeUp(0.18)}
            whileHover={reduceMotion ? undefined : { y: -4 }}
            onClick={() => onNavigate("finance")}
            className="group relative overflow-hidden bg-slate-900 neu-raised p-4 rounded-2xl transition-[box-shadow] duration-300 cursor-pointer flex flex-col justify-between"
            id="stat-monthly-balance"
          >
            <ShimmerLine via={balancePositive ? "via-emerald-500/50" : "via-rose-500/50"} />
            <div aria-hidden className={`absolute inset-0 rounded-2xl pointer-events-none ${balancePositive ? "bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.emerald.500/0.18),transparent_65%)]" : "bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.rose.500/0.18),transparent_65%)]"}`} />
            <div className="relative flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">{t("dashboard.stats.balance")}</span>
              <div className={`p-2 rounded-xl group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300 ${balancePositive ? "bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 ring-1 ring-emerald-500/20 text-emerald-400" : "bg-gradient-to-br from-rose-500/25 to-rose-500/5 ring-1 ring-rose-500/20 text-rose-400"}`}>
                <Wallet className="w-5 h-5" />
              </div>
            </div>
            <div className="relative mt-3">
              <span className={`text-xl md:text-2xl font-bold tabular-nums leading-tight ${balancePositive ? "text-emerald-400" : "text-rose-400"}`}>
                {financialSummary.balance.toLocaleString()}đ
              </span>
              <p className="text-slate-500 text-xs mt-1">{t("dashboard.stats.balanceSub")}</p>
            </div>
          </motion.div>

          {/* Card 2: Urgent Tasks */}
          <motion.div
            {...fadeUp(0.23)}
            whileHover={reduceMotion ? undefined : { y: -4 }}
            onClick={() => onNavigate("tasks")}
            className="group relative overflow-hidden bg-slate-900 neu-raised p-4 rounded-2xl transition-[box-shadow] duration-300 cursor-pointer flex flex-col justify-between"
            id="stat-urgent-tasks"
          >
            <ShimmerLine via="via-rose-500/50" />
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.rose.500/0.18),transparent_65%)] pointer-events-none" />
            <div className="relative flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">{t("dashboard.stats.urgent")}</span>
              <div className="bg-gradient-to-br from-rose-500/25 to-rose-500/5 ring-1 ring-rose-500/20 p-2 rounded-xl text-rose-400 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <AlertCircle className={`w-5 h-5 ${urgentTasksCount > 0 && !reduceMotion ? "animate-bounce" : ""}`} />
              </div>
            </div>
            <div className="relative mt-2">
              <motion.span
                key={urgentTasksCount}
                initial={reduceMotion ? false : { scale: 0.6, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 18 }}
                className="text-6xl font-black tabular-nums leading-none bg-gradient-to-br from-rose-300 via-rose-400 to-rose-600 bg-clip-text text-transparent inline-block"
              >
                <AnimatedNumber value={urgentTasksCount} format={(n) => String(Math.round(n))} />
              </motion.span>
              <p className="text-slate-500 text-xs mt-1">{t("dashboard.stats.urgentSub")}</p>
            </div>
          </motion.div>

          {/* Card 3: My Remaining Tasks */}
          <motion.div
            {...fadeUp(0.28)}
            whileHover={reduceMotion ? undefined : { y: -4 }}
            onClick={() => onNavigate("tasks")}
            className="group relative overflow-hidden bg-slate-900 neu-raised p-4 rounded-2xl transition-[box-shadow] duration-300 cursor-pointer flex flex-col justify-between"
            id="stat-my-tasks"
          >
            <ShimmerLine via="via-sky-500/50" />
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.sky.500/0.18),transparent_65%)] pointer-events-none" />
            <div className="relative flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">{t("dashboard.stats.myTasks")}</span>
              <div className="bg-gradient-to-br from-sky-500/25 to-sky-500/5 ring-1 ring-sky-500/20 p-2 rounded-xl text-sky-400 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <CheckSquare className="w-5 h-5" />
              </div>
            </div>
            <div className="relative mt-2">
              <motion.span
                key={myRemainingTasks.length}
                initial={reduceMotion ? false : { scale: 0.6, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 18 }}
                className="text-6xl font-black tabular-nums leading-none bg-gradient-to-br from-sky-200 via-sky-400 to-sky-600 bg-clip-text text-transparent inline-block"
              >
                <AnimatedNumber value={myRemainingTasks.length} format={(n) => String(Math.round(n))} />
              </motion.span>
              <p className="text-slate-500 text-xs mt-1">{t("dashboard.stats.myTasksSub")}</p>
            </div>
          </motion.div>

          {/* Card 4: Upcoming Schedule */}
          <motion.div
            {...fadeUp(0.33)}
            whileHover={reduceMotion ? undefined : { y: -4 }}
            onClick={() => onNavigate("plans")}
            className="group relative overflow-hidden bg-slate-900 neu-raised p-4 rounded-2xl transition-[box-shadow] duration-300 cursor-pointer flex flex-col justify-between"
            id="stat-schedules"
          >
            <ShimmerLine via="via-amber-500/50" />
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_100%_0%,theme(colors.amber.500/0.18),transparent_65%)] pointer-events-none" />
            <div className="relative flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">{t("dashboard.stats.schedule")}</span>
              <div className="bg-gradient-to-br from-amber-500/25 to-amber-500/5 ring-1 ring-amber-500/20 p-2 rounded-xl text-amber-400 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <div className="relative mt-2">
              <motion.span
                key={upcomingPlans.length}
                initial={reduceMotion ? false : { scale: 0.6, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 18 }}
                className="text-6xl font-black tabular-nums leading-none bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent inline-block"
              >
                <AnimatedNumber value={upcomingPlans.length} format={(n) => String(Math.round(n))} />
              </motion.span>
              <p className="text-slate-500 text-xs mt-1">{t("dashboard.stats.scheduleSub")}</p>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Main Dashboard Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="dashboard-grid">

        {/* Left Column - Schedules & Notes (Col 7) */}
        <motion.div {...fadeUp(0.3)} className="lg:col-span-7 space-y-6">

          {/* Upcoming Schedule */}
          <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 neu-raised space-y-4" id="widget-upcoming-plans">
            <ShimmerLine via="via-amber-500/50" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <IconChip accent="amber"><Calendar className="w-4 h-4" /></IconChip>
                {t("dashboard.plans.title")}
              </h3>
              <button
                onClick={() => onNavigate("plans")}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 group cursor-pointer"
              >
                {t("dashboard.plans.detail")}
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>

            {upcomingPlans.length === 0 ? (
              <div className="bg-slate-950/40 border border-dashed border-slate-800 p-6 rounded-xl text-center">
                <p className="text-sm text-slate-500">{t("dashboard.plans.empty")}</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto overscroll-contain scrollbar-thin pr-1">
                {upcomingPlans.map((item) => {
                  const colorMap: any = {
                    emerald: "border-l-4 border-emerald-500 bg-emerald-500/5",
                    sky: "border-l-4 border-sky-500 bg-sky-500/5",
                    amber: "border-l-4 border-amber-500 bg-amber-500/5",
                    rose: "border-l-4 border-rose-500 bg-rose-500/5",
                    holiday: "border-l-4 border-amber-500 bg-amber-500/10"
                  };
                  const clickable = !item.isHoliday && !!item.planId;
                  return (
                    <div
                      key={item.key}
                      onClick={clickable ? () => onViewPlan(item.planId) : undefined}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onViewPlan(item.planId); } } : undefined}
                      title={clickable ? t("dashboard.plans.viewEvent") : undefined}
                      className={`p-3 rounded-xl flex items-center justify-between ${colorMap[item.color] || "border-l-4 border-slate-600 bg-slate-800/10"} hover:bg-slate-800/30 hover:translate-x-1 transition-all duration-300 ${clickable ? "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40" : ""}`}
                    >
                      <div className="space-y-0.5 max-w-[70%] min-w-0">
                        <span className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{item.title}</span>
                          {item.isHoliday && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">{t("dashboard.plans.holiday")}</span>}
                          {item.recur && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">{t(`dashboard.recur.${item.recur}`)}</span>}
                        </span>
                        <p className="text-xs text-slate-500 truncate">{item.description || t("dashboard.plans.noDesc")}</p>
                      </div>
                      <div className="text-right flex flex-col justify-center shrink-0">
                        <span className="text-xs font-semibold text-slate-300 font-mono">{item.dateLabel}</span>
                        <span className="text-[10px] font-mono text-amber-400/80">{item.isHoliday ? t("dashboard.plans.allDay") : item.timeLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Birthdays — ẩn nếu không có ai */}
          {upcomingBirthdays.length > 0 && (
            <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 neu-raised space-y-4" id="widget-birthdays">
              <ShimmerLine via="via-pink-500/50" />
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <IconChip accent="pink"><Cake className="w-4 h-4" /></IconChip>
                {t("dashboard.birthdays.title")}
              </h3>
              <div className="space-y-2.5">
                {upcomingBirthdays.map(b => (
                  <div key={b.user.id} className={`flex items-center justify-between p-3 rounded-xl neu-pressed-sm transition-all duration-300 hover:translate-x-1 ${b.daysUntil === 0 ? "bg-gradient-to-r from-pink-500/12 to-fuchsia-500/5" : "bg-slate-950/40 hover:bg-slate-800/30"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar user={b.user} className="w-9 h-9 rounded-xl text-sm" extraClass="shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-200 truncate">{b.user.fullName}</p>
                        <p className="text-[11px] text-slate-500">{t("dashboard.birthdays.turns", { age: b.turningAge, day: b.day, month: b.month })}</p>
                      </div>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0 ${b.daysUntil === 0 ? "bg-pink-500/15 text-pink-400" : "bg-slate-800 text-slate-300"}`}>
                      {b.daysUntil === 0 ? t("dashboard.birthdays.today") : t("dashboard.birthdays.inDays", { n: b.daysUntil })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nhắc người nhà: gửi thông báo (+ push) cho một thành viên hoặc cả nhà
              — đặt cạnh cụm Sự kiện/Sinh nhật để tiện "thấy lịch → nhắc luôn" */}
          <QuickNudge currentUser={currentUser} users={users} />

          {/* Quick Pinned Notes */}
          <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 neu-raised space-y-4" id="widget-pinned-notes">
            <ShimmerLine via="via-sky-500/50" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <IconChip accent="sky"><FileText className="w-4 h-4" /></IconChip>
                {t("dashboard.notes.title")}
              </h3>
              <button
                onClick={() => onNavigate("notes")}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 group cursor-pointer"
              >
                {t("dashboard.notes.all")}
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>

            {pinnedNotes.length === 0 ? (
              <div className="bg-slate-950/40 border border-dashed border-slate-800 p-6 rounded-xl text-center">
                <p className="text-sm text-slate-500">{t("dashboard.notes.empty")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                {pinnedNotes.map((note) => {
                  const creator = users.find(u => u.id === note.creatorId);
                  return (
                    <div
                      key={note.id}
                      onClick={() => onNavigate("notes")}
                      className="bg-slate-950 hover:bg-slate-800/40 border border-slate-800/80 hover:border-sky-500/30 p-3.5 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-500/5 flex flex-col justify-between min-h-[140px] shadow-sm relative group"
                    >
                      <div className="space-y-1.5 overflow-hidden">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded border border-yellow-500/10">Pinned</span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-200 group-hover:text-sky-400 transition-colors line-clamp-1">{note.title}</h4>
                        <div className="relative max-h-[4.75rem] overflow-hidden [&>div]:text-[11px] [&_*]:!mt-0 [&_*]:!mb-0 [&>div>*+*]:!mt-1">
                          <Suspense fallback={<MarkdownFallback />}>
                            <MarkdownView content={note.content} />
                          </Suspense>
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-slate-950 to-transparent" />
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between text-[10px] text-slate-500">
                        <span>{creator ? creator.fullName.split(" ")[0] : t("dashboard.notes.member")}</span>
                        <span>{new Date(note.updatedAt).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Right Column - Finances (Month Breakdown) & Activities Logger (Col 5) */}
        <motion.div {...fadeUp(0.38)} className="lg:col-span-5 space-y-6">

          {/* Recent Money Widget */}
          <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 neu-raised space-y-4" id="widget-finance-overview">
            <ShimmerLine via="via-emerald-500/50" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <IconChip accent="emerald"><Wallet className="w-4 h-4" /></IconChip>
                {t("dashboard.finance.title", { month: new Date().getMonth() + 1 })}
              </h3>
              <button
                onClick={() => onNavigate("finance")}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 group cursor-pointer"
              >
                {t("dashboard.finance.fund")}
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>

            {/* Income-Expense mini comparison graph */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/50 space-y-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="space-y-1">
                  <span className="flex items-center gap-1 text-[11px]"><TrendingUp className="w-3 h-3 text-emerald-400" /> {t("dashboard.finance.income")}</span>
                  <p className="text-sm font-bold text-slate-200 font-mono">{financialSummary.income.toLocaleString()}đ</p>
                </div>
                <div className="text-right space-y-1">
                  <span className="flex items-center gap-1 justify-end text-[11px]"><TrendingDown className="w-3 h-3 text-rose-400" /> {t("dashboard.finance.expense")}</span>
                  <p className="text-sm font-bold text-slate-200 font-mono">{financialSummary.expense.toLocaleString()}đ</p>
                </div>
              </div>

              {/* Graphical Bar — fills up from 0 once the page enters */}
              <div className="space-y-1.5">
                <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden flex">
                  {financeTotal > 0 ? (
                    <>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${incomePct}%` }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 1, delay: 0.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                      />
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${expensePct}%` }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 1, delay: 0.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-rose-400 to-rose-500"
                      />
                    </>
                  ) : (
                    <div className="h-full w-full bg-slate-800" />
                  )}
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                  <span>{t("dashboard.finance.pctIncome", { pct: financeTotal > 0 ? Math.round(incomePct) : 0 })}</span>
                  <span>{t("dashboard.finance.pctExpense", { pct: financeTotal > 0 ? Math.round(expensePct) : 0 })}</span>
                </div>
              </div>
            </div>

            {/* Top 3 hạng mục tiêu dùng đứng đầu trong tháng */}
            {topExpenseCategories.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" /> {t("dashboard.finance.topCategories")}
                </div>
                <div className="space-y-2">
                  {topExpenseCategories.map(({ category, amount, pct }, i) => {
                    const meta = expenseCatMeta(category, customCategories);
                    return (
                      <div key={category} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1.5 text-slate-300 font-medium truncate">
                            <span className="text-slate-500 font-mono text-[10px] w-3.5 shrink-0">{i + 1}.</span>
                            <span className="shrink-0">{meta.emoji}</span>
                            <span className="truncate">{meta.label}</span>
                          </span>
                          <span className="font-mono text-slate-200 shrink-0 pl-2">{amount.toLocaleString()}đ</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(4, pct)}%` }}
                            transition={reduceMotion ? { duration: 0 } : { duration: 0.9, delay: 0.5 + i * 0.1, ease: "easeOut" }}
                            className={`h-full bg-gradient-to-r ${meta.bar}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Activity Logs inside family */}
          <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 neu-raised space-y-4" id="widget-activity-logs">
            <ShimmerLine via="via-indigo-500/50" />
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <IconChip accent="indigo"><Activity className="w-4 h-4" /></IconChip>
              {t("dashboard.activity.title")}
            </h3>

            <div className="bg-slate-950 p-2 rounded-xl neu-pressed-sm max-h-[178px] overflow-y-auto space-y-2 font-mono scrollbar-thin">
              {activityLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">{t("dashboard.activity.empty")}</div>
              ) : (
                activityLogs.map((log) => {
                  const formatTime = (isoString: string) => {
                    const d = new Date(isoString);
                    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                  };
                  return (
                    <div key={log.id} className="text-[11px] p-2 hover:bg-slate-900/50 rounded transition-all text-slate-300 border-l border-slate-800/80 hover:border-indigo-500/50">
                      <div className="flex items-center justify-between text-slate-500 text-[10px] pb-0.5">
                        <span className="font-semibold text-sky-400/90">@{log.username}</span>
                        <span>{formatTime(log.createdAt)}</span>
                      </div>
                      <span className="text-indigo-400 font-semibold">{log.action}: </span>
                      <span className="text-slate-400 font-sans">{log.details}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </motion.div>
      </div>
    </div>
  );
}
