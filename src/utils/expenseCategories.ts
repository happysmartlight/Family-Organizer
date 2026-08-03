/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Nguồn chân lý DUY NHẤT cho hạng mục CHI — dùng chung bởi Finance, Dashboard và
// Settings. Trước đây bảng màu/emoji/nhãn bị lặp ở nhiều nơi; gom về đây để:
//   1. Hạng mục MẶC ĐỊNH (developer) không đổi, luôn có sẵn.
//   2. Admin thêm hạng mục RIÊNG (tên + emoji + màu) và ẩn bớt mặc định không dùng.
//
// Giá trị lưu trong transaction.category là:
//   - key mặc định (food/utilities/…) → nhãn dịch qua i18n "categories.<key>", hoặc
//   - id hạng mục tự thêm (cc_…)      → nhãn lấy trực tiếp từ bản ghi custom.

import i18n from "../i18n/index.js";
import type { CustomExpenseCategory } from "../types.js";

export interface ExpenseCatColor {
  /** gradient thanh biểu đồ, vd "from-orange-500 to-orange-400" */
  bar: string;
  /** màu chữ icon, vd "text-orange-400" */
  text: string;
  /** chip nền + chữ cho dòng giao dịch, vd "text-orange-400 bg-orange-500/10" */
  chip: string;
}

// Bảng màu: KEY màu → lớp Tailwind viết LITERAL đầy đủ (để JIT không bị purge).
// Đây cũng là bộ màu Admin chọn khi tạo hạng mục riêng.
export const EXPENSE_CAT_COLORS: Record<string, ExpenseCatColor> = {
  orange: { bar: "from-orange-500 to-orange-400", text: "text-orange-400", chip: "text-orange-400 bg-orange-500/10" },
  amber:  { bar: "from-amber-500 to-amber-400",   text: "text-amber-400",  chip: "text-amber-400 bg-amber-500/10" },
  yellow: { bar: "from-yellow-500 to-yellow-400", text: "text-yellow-400", chip: "text-yellow-400 bg-yellow-500/10" },
  lime:   { bar: "from-lime-500 to-lime-400",     text: "text-lime-400",   chip: "text-lime-400 bg-lime-500/10" },
  emerald:{ bar: "from-emerald-500 to-emerald-400", text: "text-emerald-400", chip: "text-emerald-400 bg-emerald-500/10" },
  teal:   { bar: "from-teal-500 to-teal-400",     text: "text-teal-400",   chip: "text-teal-400 bg-teal-500/10" },
  cyan:   { bar: "from-cyan-500 to-cyan-400",     text: "text-cyan-400",   chip: "text-cyan-400 bg-cyan-500/10" },
  sky:    { bar: "from-sky-500 to-sky-400",       text: "text-sky-400",    chip: "text-sky-400 bg-sky-500/10" },
  indigo: { bar: "from-indigo-500 to-indigo-400", text: "text-indigo-400", chip: "text-indigo-400 bg-indigo-500/10" },
  violet: { bar: "from-violet-500 to-violet-400", text: "text-violet-400", chip: "text-violet-400 bg-violet-500/10" },
  purple: { bar: "from-purple-500 to-purple-400", text: "text-purple-400", chip: "text-purple-400 bg-purple-500/10" },
  pink:   { bar: "from-pink-500 to-pink-400",     text: "text-pink-400",   chip: "text-pink-400 bg-pink-500/10" },
  rose:   { bar: "from-rose-500 to-rose-400",     text: "text-rose-400",   chip: "text-rose-400 bg-rose-500/10" },
  red:    { bar: "from-red-500 to-red-400",       text: "text-red-400",    chip: "text-red-400 bg-red-500/10" },
  zinc:   { bar: "from-zinc-500 to-zinc-400",     text: "text-zinc-400",   chip: "text-zinc-400 bg-zinc-500/15" },
  slate:  { bar: "from-slate-600 to-slate-500",   text: "text-slate-400",  chip: "text-slate-400 bg-slate-800" },
};

/** Danh sách KEY màu cho bộ chọn màu ở Thiết lập. */
export const EXPENSE_CAT_COLOR_KEYS = Object.keys(EXPENSE_CAT_COLORS);

const FALLBACK_COLOR: ExpenseCatColor = EXPENSE_CAT_COLORS.slate;

/** Lớp Tailwind cho 1 key màu (rơi về slate nếu key lạ/thiếu). */
export const catColor = (key?: string): ExpenseCatColor =>
  (key && EXPENSE_CAT_COLORS[key]) || FALLBACK_COLOR;

export interface BuiltinCat {
  /** key i18n & giá trị lưu trong transaction.category */
  value: string;
  emoji: string;
  color: string;
}

// Hạng mục CHI mặc định do lập trình viên web app cung cấp — KHÔNG xóa được, chỉ
// có thể ẩn. Thứ tự này cũng là thứ tự hiển thị trong ô chọn. Emoji/màu khớp với
// bộ cũ đã dùng ở Finance (CAT_BAR/categoryIcon) và Dashboard (EXPENSE_CAT_STYLE).
export const BUILTIN_EXPENSE_CATEGORIES: BuiltinCat[] = [
  { value: "food",          emoji: "🍲",  color: "orange" },
  { value: "education2",    emoji: "📚",  color: "violet" },
  { value: "utilities",     emoji: "⚡",  color: "amber" },
  { value: "shopping",      emoji: "🛍️",  color: "pink" },
  { value: "medical",       emoji: "💊",  color: "rose" },
  { value: "transport",     emoji: "🚗",  color: "sky" },
  { value: "debt_bank",     emoji: "🏦",  color: "red" },
  { value: "debt_personal", emoji: "🤝",  color: "teal" },
  { value: "funeral",       emoji: "🌸",  color: "zinc" },
  { value: "ceremony",      emoji: "🎁",  color: "yellow" },
  { value: "other",         emoji: "🏷️",  color: "slate" },
];

const BUILTIN_MAP = new Map(BUILTIN_EXPENSE_CATEGORIES.map(c => [c.value, c]));

/** true nếu value là một hạng mục mặc định (không cho phép xóa, chỉ ẩn). */
export const isBuiltinCategory = (value: string): boolean => BUILTIN_MAP.has(value);

export interface ResolvedCat {
  value: string;
  label: string;
  emoji: string;
  color: string;
  isBuiltin: boolean;
}

/**
 * Giải nghĩa một giá trị category (key mặc định HOẶC id custom) thành thông tin
 * hiển thị. Dùng cho mọi nơi render nhãn/màu/emoji của hạng mục CHI.
 * value lạ (vd hạng mục đã xóa, hoặc nhãn thu nhập free-text) → hiện nguyên văn.
 */
export function resolveCategory(value: string, custom: CustomExpenseCategory[] = []): ResolvedCat {
  const builtin = BUILTIN_MAP.get(value);
  if (builtin) {
    return {
      value,
      label: i18n.t(`categories.${value}`, { defaultValue: value }),
      emoji: builtin.emoji,
      color: builtin.color,
      isBuiltin: true,
    };
  }
  const c = custom.find(x => x.id === value);
  if (c) {
    return { value, label: c.label, emoji: c.emoji || "🏷️", color: c.color || "slate", isBuiltin: false };
  }
  return {
    value,
    label: i18n.t(`categories.${value}`, { defaultValue: value }),
    emoji: "🏷️",
    color: "slate",
    isBuiltin: false,
  };
}

/**
 * Danh sách hạng mục CHI đang HOẠT ĐỘNG để hiển thị trong ô chọn:
 * mặc định (trừ những cái đã ẩn) + toàn bộ hạng mục tự thêm.
 */
export function activeExpenseCategories(
  custom: CustomExpenseCategory[] = [],
  hidden: string[] = []
): ResolvedCat[] {
  const hiddenSet = new Set(hidden);
  const builtins = BUILTIN_EXPENSE_CATEGORIES
    .filter(c => !hiddenSet.has(c.value))
    .map(c => resolveCategory(c.value, custom));
  const customs = custom.map(c => resolveCategory(c.id, custom));
  return [...builtins, ...customs];
}
