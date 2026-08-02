/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  TrendingUp,
  Wallet,
  Trash2,
  Search,
  Calendar,
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Filter,
  X,
  CreditCard,
  FileText,
  FileDown,
  CheckCircle2,
  Pencil,
  RotateCcw,
  BarChart3,
  Utensils,
  GraduationCap,
  Zap,
  ShoppingCart,
  HeartPulse,
  Car,
  Landmark,
  Users,
  HelpCircle,
  ArrowUpRight,
  ArrowDownRight,
  Home,
  Wifi,
  Phone,
  Shield,
  Flower2,
  Gift
} from "lucide-react";
import { FinancialTransaction, TransactionType, ExpenseCategory, AccountType, User, UserRole, BudgetLimit, RecurringBill, FamilyAsset, SavingsGoal, Debt, canAccessFinance } from "../types.js";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useConfirm } from "./ConfirmDialog.js";
import { Assets } from "./Assets.js";
import { SavingsGoals } from "./SavingsGoals.js";
import { DebtTracker } from "./DebtTracker.js";
import { ShimmerLine, Reveal } from "./Lively.js";
import { FancySelect } from "./FancySelect.js";
import { optimizeAndUpload } from "../utils/uploadImage.js";
import { useModalA11y } from "../hooks/useModalA11y.js";
import {
  PeriodMode, periodBounds, toDateStr, stepAnchor,
  periodMonths, pctDelta, calcTotals as calcTotalsUtil, accountBalances as accountBalancesUtil,
  monthlySeries, MonthlyPoint
} from "../utils/financePeriod.js";
import { useTabFab } from "./FabHost.js";
import { DateInputDMY, formatDateVN } from "./DateTimePicker24.js";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/index.js";

// Rút gọn số tiền cho nhãn trục/tooltip biểu đồ: 12tr, 1,5 tỷ, 500k.
const fmtShortMoney = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(".", ",").replace(",0", "") + " tỷ";
  if (abs >= 1e6) return Math.round(n / 1e6) + "tr";
  if (abs >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
};

// Màu CỐ ĐỊNH theo hạng mục — TRÙNG với categoryColorClass/categoryIcon ở phần dòng tiền,
// để liếc màu/icon là nhận ra hạng mục. Class viết literal đầy đủ cho Tailwind JIT.
const CAT_BAR: Record<string, { bar: string; text: string }> = {
  food:          { bar: "from-orange-500 to-orange-400", text: "text-orange-400" },
  education2:    { bar: "from-violet-500 to-violet-400", text: "text-violet-400" },
  utilities:     { bar: "from-amber-500 to-amber-400",   text: "text-amber-400" },
  shopping:      { bar: "from-pink-500 to-pink-400",     text: "text-pink-400" },
  medical:       { bar: "from-rose-500 to-rose-400",     text: "text-rose-400" },
  transport:     { bar: "from-sky-500 to-sky-400",       text: "text-sky-400" },
  debt_bank:     { bar: "from-red-500 to-red-400",       text: "text-red-400" },
  loan:          { bar: "from-red-500 to-red-400",       text: "text-red-400" },
  debt_personal: { bar: "from-teal-500 to-teal-400",     text: "text-teal-400" },
  funeral:       { bar: "from-zinc-500 to-zinc-400",     text: "text-zinc-400" },
  ceremony:      { bar: "from-yellow-500 to-yellow-400", text: "text-yellow-400" },
  rent:          { bar: "from-indigo-500 to-indigo-400", text: "text-indigo-400" },
  internet:      { bar: "from-cyan-500 to-cyan-400",     text: "text-cyan-400" },
  phone:         { bar: "from-purple-500 to-purple-400", text: "text-purple-400" },
  insurance:     { bar: "from-slate-500 to-slate-400",   text: "text-slate-300" },
};
const catBar = (cat: string) => CAT_BAR[cat] || { bar: "from-slate-600 to-slate-500", text: "text-slate-400" };

// Làm tròn trần "đẹp" cho trục Y (1/2/5 × 10^n) để nhãn chia đều dễ đọc.
const niceCeil = (v: number): number => {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const unit = v / pow;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * pow;
};

// Biểu đồ cột thu/chi 12 tháng — SVG thuần, tự co theo bề rộng thẻ.
// Cột emerald = thu, cột rose = chi; <title> từng cột hiện số đầy đủ khi chạm/hover.
function MonthlyTrendChart({ points }: { points: MonthlyPoint[] }) {
  const { t } = useTranslation();
  const W = 520, H = 132; // gọn — chart phụ trong nhóm So sánh, không phải khối chính
  const M = { top: 8, right: 6, bottom: 20, left: 40 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const rawMax = Math.max(1, ...points.map(p => Math.max(p.income, p.expense)));
  const yMax = niceCeil(rawMax);
  const y = (v: number) => M.top + ih - (Math.min(v, yMax) / yMax) * ih;
  const group = iw / points.length;
  const barW = Math.min(12, (group - 6) / 2);
  const ticks = [0, 0.5, 1].map(f => f * yMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t("finance.chartAriaLabel")}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className="stroke-slate-800" strokeWidth="1" strokeDasharray="3 5" />
          <text x={M.left - 5} y={y(v) + 3.5} textAnchor="end" fontSize="9" className="fill-slate-500 font-mono">
            {fmtShortMoney(v)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = M.left + i * group + group / 2;
        return (
          <g key={p.key}>
            {p.income > 0 && (
              <rect x={cx - barW - 1} y={y(p.income)} width={barW} height={Math.max(1.5, M.top + ih - y(p.income))} rx="2" fill="#34d399">
                <title>{`${p.label}: Thu ${p.income.toLocaleString("vi-VN")} đ`}</title>
              </rect>
            )}
            {p.expense > 0 && (
              <rect x={cx + 1} y={y(p.expense)} width={barW} height={Math.max(1.5, M.top + ih - y(p.expense))} rx="2" fill="#fb7185">
                <title>{`${p.label}: Chi ${p.expense.toLocaleString("vi-VN")} đ`}</title>
              </rect>
            )}
            <text x={cx} y={H - 7} textAnchor="middle" fontSize="9" className="fill-slate-500 font-mono">
              {p.label}
            </text>
          </g>
        );
      })}
      <line x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih} className="stroke-slate-800" strokeWidth="1.5" />
    </svg>
  );
}

interface FinanceProps {
  currentUser: User;
  users: User[];
  transactions: FinancialTransaction[];
  budgets: BudgetLimit[];
  recurringBills: RecurringBill[];
  savingsGoals: SavingsGoal[];
  debts: Debt[];
  assets: FamilyAsset[];
  widgets?: any;
  onSaveTransaction: (tx: Partial<FinancialTransaction>) => Promise<any>;
  onDeleteTransaction: (id: string) => Promise<any>;
  onSaveBudget: (budget: Partial<BudgetLimit>) => Promise<any>;
  onDeleteBudget: (id: string) => Promise<any>;
  onCarryForwardBudgets: (month: string) => Promise<any>;
  onSaveRecurringBill: (bill: Partial<RecurringBill>) => Promise<any>;
  onPayRecurringBill: (id: string) => Promise<any>;
  onDeleteRecurringBill: (id: string) => Promise<any>;
  onSaveSavingsGoal: (goal: Partial<SavingsGoal>) => Promise<any>;
  onDeleteSavingsGoal: (id: string) => Promise<any>;
  onContributeSavings: (goalId: string, amount: number, date: string, note?: string) => Promise<any>;
  onRemoveSavingsContribution: (goalId: string, contributionId: string) => Promise<any>;
  onSaveDebt: (debt: Partial<Debt>) => Promise<any>;
  onDeleteDebt: (id: string) => Promise<any>;
  onAddDebtPayment: (debtId: string, amount: number, date: string, note?: string) => Promise<any>;
  onRemoveDebtPayment: (debtId: string, paymentId: string) => Promise<any>;
  onSaveAsset: (asset: Partial<FamilyAsset>) => Promise<any>;
  onDeleteAsset: (id: string) => Promise<any>;
}

const BILL_CATEGORIES = [
  { value: "rent",       label: "Thuê nhà" },
  { value: "utilities",  label: "Điện nước" },
  { value: "internet",   label: "Cước Internet" },
  { value: "phone",      label: "Điện thoại" },
  { value: "insurance",  label: "Bảo hiểm" },
  { value: "medical",    label: "Y tế" },
  { value: "education2", label: "Học tập" },
  { value: "loan",       label: "Trả nợ ngân hàng" },
  { value: "other",      label: "Khác" },
] as const;

function translateBillCategory(value: string): string {
  return i18n.t(`categories.${value}`, { defaultValue: value });
}

// EXPENSE_CATEGORY_OPTIONS và BILL_FREQUENCY_OPTIONS được tạo trong component (useMemo) để dịch ngôn ngữ.

// ─── Nhập tiền thông minh: cho phép gõ biểu thức cộng dồn ───────────────────
// Ví dụ đi chợ: "50000+20000" → 70.000; "5*10000" → 50.000; "50000+5*3000" → 65.000.
// Bỏ dấu phân tách hàng nghìn (. ,) và khoảng trắng; chỉ tính + - * (không eval).
function evalMoneyExpression(input: string): number {
  if (!input || !input.trim()) return 0;
  // Bỏ khoảng trắng + dấu phân tách hàng nghìn, cắt các toán tử thừa ở cuối (đang gõ dở)
  const cleaned = input.replace(/[\s.,]/g, "").replace(/[+\-*]+$/, "");
  if (!cleaned) return 0;
  // Không phải biểu thức hợp lệ → lấy phần chữ số cho an toàn
  if (!/^[+\-]?\d+([+\-*]\d+)*$/.test(cleaned)) {
    return Number(cleaned.replace(/[^\d]/g, "")) || 0;
  }
  // Tách theo + / - (giữ dấu), mỗi số hạng có thể chứa phép nhân
  const terms = cleaned.match(/[+\-]?[^+\-]+/g) || [];
  let total = 0;
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const factors = term.replace(/^[+\-]/, "").split("*").map(Number);
    total += sign * factors.reduce((a, b) => a * b, 1);
  }
  return Math.round(total);
}

// Nhóm hàng nghìn cho CẢ biểu thức đang gõ: "50000+20000" → "50.000+20.000".
// Giữ lại toán tử + - *, bỏ mọi ký tự khác (kể cả dấu chấm cũ) rồi nhóm lại từng số.
function formatMoneyExpr(input: string): string {
  const cleaned = input.replace(/[^\d+\-*]/g, "");
  return cleaned.replace(/\d+/g, (m) => Number(m).toLocaleString("vi-VN"));
}

interface MoneyInputProps {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  /** Hiện nút +/× hỗ trợ cộng dồn (bàn phím số trên mobile không có toán tử). */
  operators?: boolean;
}

/**
 * Ô nhập tiền: LUÔN hiển thị số có nhóm hàng nghìn (2.000.000), kể cả khi đang
 * gõ biểu thức cộng dồn (50.000+20.000). Có nút +/× (tuỳ chọn) và dòng preview
 * kết quả "= 70.000 đ". Quy tắc chung cho mọi ô tiền trong app.
 */
function MoneyInput({ value, onChange, placeholder, className, id, autoFocus, operators }: MoneyInputProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasOperator = /\d\s*[+\-*]\s*\d/.test(raw);
  const preview = evalMoneyExpression(raw);
  // Khi rời ô: hiển thị theo value đã chốt; khi đang gõ: hiển thị raw (đã nhóm nghìn)
  const display = focused ? raw : (value > 0 ? value.toLocaleString("vi-VN") : "");

  const commit = () => {
    onChange(evalMoneyExpression(raw));
    setFocused(false);
  };

  const setFromInput = (text: string) => {
    const formatted = formatMoneyExpr(text);
    setRaw(formatted);
    onChange(evalMoneyExpression(formatted));
  };

  const appendOp = (op: string) => {
    const base = raw.trim() === "" && value > 0 ? value.toLocaleString("vi-VN") : raw;
    const trimmed = base.replace(/[+\-*]+$/, "");
    if (trimmed === "") return;
    const next = trimmed + op;
    setRaw(next);
    setFocused(true);
    onChange(evalMoneyExpression(next));
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="flex items-stretch gap-1.5">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          value={display}
          placeholder={placeholder}
          onFocus={() => { setRaw(value > 0 ? value.toLocaleString("vi-VN") : ""); setFocused(true); }}
          onChange={(e) => setFromInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); inputRef.current?.blur(); } }}
          className={className}
        />
        {operators && (
          <div className="flex gap-1 shrink-0">
            <button
              type="button" tabIndex={-1} aria-label={t("finance.moneyAddPlus")}
              onPointerDown={(e) => e.preventDefault()} onClick={() => appendOp("+")}
              className="w-9 grid place-items-center rounded-lg bg-slate-800 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-400 font-bold text-lg leading-none transition-colors"
            >+</button>
            <button
              type="button" tabIndex={-1} aria-label={t("finance.moneyMulTimes")}
              onPointerDown={(e) => e.preventDefault()} onClick={() => appendOp("*")}
              className="w-9 grid place-items-center rounded-lg bg-slate-800 hover:bg-sky-500/20 text-slate-300 hover:text-sky-400 font-bold text-sm leading-none transition-colors"
            >×</button>
          </div>
        )}
      </div>
      {focused && hasOperator && (
        <p className="mt-1 text-[11px] font-mono font-bold text-emerald-400">= {preview.toLocaleString("vi-VN")} đ</p>
      )}
    </div>
  );
}

// Hạng mục THU NHẬP gợi ý — giá trị lưu trực tiếp là nhãn tiếng Việt (income category là free-text).
// Chọn "__custom__" để tự nhập nguồn thu khác.
const INCOME_CATEGORIES = [
  "Lương tháng",
  "Tiền thưởng",
  "Làm thêm / Freelance",
  "Hoa hồng bán hàng",
  "Cổ tức",
  "Lợi nhuận cổ phần / Đầu tư",
  "Cho thuê (nhà/xe...)",
  "Tiền mượn / Vay",
  "Được cho / Biếu tặng",
] as const;
const INCOME_CUSTOM = "__custom__";
const isPresetIncome = (cat: string) => (INCOME_CATEGORIES as readonly string[]).includes(cat);

function isAlreadyPaidThisPeriod(bill: RecurringBill): boolean {
  if (!bill.lastPaidDate) return false;
  const today = new Date();
  const paid = new Date(bill.lastPaidDate);
  if (bill.frequency === "monthly")
    return paid.getFullYear() === today.getFullYear() && paid.getMonth() === today.getMonth();
  if (bill.frequency === "yearly")
    return paid.getFullYear() === today.getFullYear();
  // weekly: paid within last 7 days
  return today.getTime() - paid.getTime() < 7 * 24 * 60 * 60 * 1000;
}

function payButtonLabel(frequency: RecurringBill["frequency"]): string {
  if (frequency === "weekly") return i18n.t("finance.dueWeek");
  if (frequency === "yearly") return i18n.t("finance.dueYear");
  return i18n.t("finance.dueMonth");
}

// ─── Kỳ xem: Tháng (mặc định) / Quý / Năm ────────────────────────────────
// Mỗi kỳ được cô lập để so sánh với kỳ liền trước. Mốc `anchor` là một ngày
// bất kỳ nằm trong kỳ đang xem; logic kỳ/tổng/số dư ví tách ở utils/financePeriod
// (thuần, có test) — file này chỉ giữ phần UI.

export function Finance({
  currentUser,
  users,
  transactions,
  budgets,
  recurringBills,
  savingsGoals,
  debts,
  assets,
  widgets,
  onSaveTransaction,
  onDeleteTransaction,
  onSaveBudget,
  onDeleteBudget,
  onCarryForwardBudgets,
  onSaveRecurringBill,
  onPayRecurringBill,
  onDeleteRecurringBill,
  onSaveSavingsGoal,
  onDeleteSavingsGoal,
  onContributeSavings,
  onRemoveSavingsContribution,
  onSaveDebt,
  onDeleteDebt,
  onAddDebtPayment,
  onRemoveDebtPayment,
  onSaveAsset,
  onDeleteAsset
}: FinanceProps) {
  const { t, i18n: i18nHook } = useTranslation();

  const tPeriodMode = (m: PeriodMode): string =>
    m === "month" ? t("finance.periodMonth")
    : m === "quarter" ? t("finance.periodQuarter")
    : t("finance.periodYear");

  const tPeriodLabel = (mode: PeriodMode, a: Date): string => {
    const yyyy = a.getFullYear();
    if (mode === "year") return t("finance.periodLabelYear", { yyyy });
    if (mode === "quarter") return t("finance.periodLabelQuarter", { q: Math.floor(a.getMonth() / 3) + 1, yyyy });
    return t("finance.periodLabelMonth", { mm: String(a.getMonth() + 1).padStart(2, "0"), yyyy });
  };

  const expenseCategoryOptions = useMemo(() => [
    { value: "food",          label: t("categories.food") + " 🍲" },
    { value: "education2",    label: t("categories.education2") + " 📚" },
    { value: "utilities",     label: t("categories.utilities") + " ⚡" },
    { value: "shopping",      label: t("categories.shopping") + " 🛍️" },
    { value: "medical",       label: t("categories.medical") + " 💊" },
    { value: "transport",     label: t("categories.transport") + " 🚗" },
    { value: "debt_bank",     label: t("categories.debt_bank") + " 🏦" },
    { value: "debt_personal", label: t("categories.debt_personal") + " 🤝" },
    { value: "funeral",       label: t("categories.funeral") + " 🌸" },
    { value: "ceremony",      label: t("categories.ceremony") + " 🎁" },
    { value: "other",         label: t("categories.other") + " 🏷️" }
  ], [i18nHook.language]);

  const billFrequencyOptions = useMemo(() => [
    { value: "weekly",  label: t("finance.billFreqWeekly") },
    { value: "monthly", label: t("finance.billFreqMonthly") },
    { value: "yearly",  label: t("finance.billFreqYearly") }
  ], [i18nHook.language]);

  const billCategoryOptions = useMemo(() => BILL_CATEGORIES.map(c => ({
    value: c.value,
    label: i18n.t(`categories.${c.value}`, { defaultValue: c.label })
  })), [i18nHook.language]);

  const [financeView, setFinanceView] = useState<"cashflow" | "assets">("cashflow");
  // Kỳ xem (Tháng/Quý/Năm) + mốc ngày trong kỳ + bật bảng so sánh 2 cột
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showCompare, setShowCompare] = useState(false);
  // Query Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");

  // Interactive controls
  const [isFormOpen, setIsFormOpen] = useState(false);
  // Giao dịch đang sửa (null = form đang ở chế độ tạo mới)
  const [editingTx, setEditingTx] = useState<FinancialTransaction | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  // In-app confirmation dialog (replaces native browser confirm)
  const { confirm, ConfirmDialog } = useConfirm();

  // Create fields
  const [formType, setFormType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formCategory, setFormCategory] = useState<ExpenseCategory | string>(ExpenseCategory.FOOD);
  const [formAccount, setFormAccount] = useState<AccountType>(AccountType.BANK);
  const [formDesc, setFormDesc] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formReceiptBase64, setFormReceiptBase64] = useState<string>("");
  const [receiptProcessing, setReceiptProcessing] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState<string>(ExpenseCategory.FOOD);
  const [budgetLimit, setBudgetLimit] = useState<number>(0);
  const [budgetError, setBudgetError] = useState("");
  // Sửa nhanh hạn mức ngân sách ngay trong danh sách (inline)
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingBudgetLimit, setEditingBudgetLimit] = useState<number>(0);
  const [billTitle, setBillTitle] = useState("");
  const [billAmount, setBillAmount] = useState<number>(0);
  const [billDueDate, setBillDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [billCategory, setBillCategory] = useState<string>(ExpenseCategory.UTILITIES);
  const [billFrequency, setBillFrequency] = useState<RecurringBill["frequency"]>("monthly");
  const [billError, setBillError] = useState("");
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editCategory, setEditCategory] = useState<string>(BILL_CATEGORIES[0].value);
  const [editFrequency, setEditFrequency] = useState<RecurringBill["frequency"]>("monthly");
  const [editDueDate, setEditDueDate] = useState("");
  const [editError, setEditError] = useState("");

  // Escape-to-close + scroll lock + focus trap for the form, receipt viewer & bill editor
  const formRef = useRef<HTMLDivElement | null>(null);
  const receiptRef = useRef<HTMLDivElement | null>(null);
  const billEditorRef = useRef<HTMLDivElement | null>(null);
  const closeForm = useCallback(() => { setIsFormOpen(false); setEditingTx(null); }, []);
  const closeReceipt = useCallback(() => setSelectedReceipt(null), []);
  const closeBillEditor = useCallback(() => setEditingBill(null), []);
  useModalA11y(isFormOpen, closeForm, formRef);
  useModalA11y(!!selectedReceipt, closeReceipt, receiptRef);
  useModalA11y(!!editingBill, closeBillEditor, billEditorRef);

  // Mở form ở chế độ TẠO MỚI: reset toàn bộ field (tránh dính dữ liệu từ lần sửa trước)
  const openCreateForm = () => {
    setEditingTx(null);
    setFormType(TransactionType.EXPENSE);
    setFormCategory(ExpenseCategory.FOOD);
    setFormAccount(AccountType.BANK);
    setFormAmount(0);
    setFormDesc("");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormReceiptBase64("");
    setFormError("");
    setIsFormOpen(true);
  };

  // Mở form ở chế độ SỬA: điền sẵn dữ liệu của giao dịch được chọn
  const openEditTransaction = (tx: FinancialTransaction) => {
    setEditingTx(tx);
    setFormType(tx.type);
    setFormAmount(tx.amount);
    setFormCategory(tx.category);
    setFormAccount(tx.account);
    setFormDesc(tx.description);
    setFormDate(tx.date);
    setFormReceiptBase64(tx.receiptImage || "");
    setFormError("");
    setIsFormOpen(true);
  };

  // Nút nổi thêm nhanh — chỉ hiện ở view thu chi, ẩn khi đang mở form
  useTabFab(
    canAccessFinance(currentUser.role) && financeView === "cashflow" && !isFormOpen
      ? { id: "finance", color: "emerald", title: t("finance.addFab"), icon: Wallet, onClick: openCreateForm }
      : null
  );

  // Money input formatting: show grouped thousands (1.000.000), store as number.
  const formatMoneyInput = (n: number) => (n > 0 ? n.toLocaleString("vi-VN") : "");
  const parseMoneyInput = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

  // ─── Biên kỳ hiện tại & kỳ liền trước (để lọc + so sánh) ────────────────
  const { start, end } = useMemo(() => periodBounds(periodMode, anchor), [periodMode, anchor]);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);
  const prevAnchor = useMemo(() => stepAnchor(periodMode, anchor, -1), [periodMode, anchor]);
  const prevBounds = useMemo(() => periodBounds(periodMode, prevAnchor), [periodMode, prevAnchor]);
  const prevStartStr = toDateStr(prevBounds.start);
  const prevEndStr = toDateStr(prevBounds.end);
  const todayStr = toDateStr(new Date());
  const isCurrentPeriod = startStr <= todayStr && todayStr <= endStr;
  const canGoNext = endStr < todayStr; // không cho vượt quá kỳ hiện tại

  // Giao dịch thuộc kỳ này / kỳ trước (chỉ lọc theo thời gian, không theo bộ lọc tìm kiếm)
  const periodTx = useMemo(
    () => transactions.filter(tx => tx.date >= startStr && tx.date <= endStr),
    [transactions, startStr, endStr]
  );
  const prevTx = useMemo(
    () => transactions.filter(tx => tx.date >= prevStartStr && tx.date <= prevEndStr),
    [transactions, prevStartStr, prevEndStr]
  );

  // Process filters
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // 0. Thuộc kỳ đang xem
      if (tx.date < startStr || tx.date > endStr) return false;

      // 1. Text description search
      if (searchTerm && !tx.description.toLowerCase().includes(searchTerm.toLowerCase())) return false;

      // 2. Category
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;

      // 3. Account wallet
      if (accountFilter !== "all" && tx.account !== accountFilter) return false;

      // 4. Type
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;

      // 5. Creator member
      if (memberFilter !== "all" && tx.creatorId !== memberFilter) return false;

      return true;
    }).sort((a, b) =>
      // Ưu tiên ngày giao dịch (mới nhất trước); cùng ngày thì xếp theo thời điểm
      // ghi (createdAt ISO) để bản ghi vừa thêm luôn nhảy lên đầu danh sách.
      b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")
    );
  }, [transactions, startStr, endStr, searchTerm, categoryFilter, accountFilter, typeFilter, memberFilter]);

  // Tổng Thu/Chi/Cân đối của một tập giao dịch (logic thuần ở utils/financePeriod)
  const calcTotals = useCallback((list: FinancialTransaction[]) => calcTotalsUtil(list), []);

  const reduceMotion = useReducedMotion();

  // Chỉ số của kỳ đang xem + kỳ liền trước (để hiện delta)
  const metrics = useMemo(() => calcTotals(periodTx), [calcTotals, periodTx]);
  const prevMetrics = useMemo(() => calcTotals(prevTx), [calcTotals, prevTx]);

  // Chi tiêu theo hạng mục cho kỳ này / kỳ trước (dùng cho bảng so sánh)
  const expenseByCat = useCallback((list: FinancialTransaction[]) => {
    const m: Record<string, number> = {};
    list.forEach(tx => { if (tx.type === "expense") m[tx.category] = (m[tx.category] || 0) + tx.amount; });
    return m;
  }, []);
  const curCatMap = useMemo(() => expenseByCat(periodTx), [expenseByCat, periodTx]);
  const prevCatMap = useMemo(() => expenseByCat(prevTx), [expenseByCat, prevTx]);
  const compareCatKeys = useMemo(
    () => Array.from(new Set([...Object.keys(curCatMap), ...Object.keys(prevCatMap)]))
      .sort((a, b) => (curCatMap[b] || 0) - (curCatMap[a] || 0)),
    [curCatMap, prevCatMap]
  );

  // Số dư theo từng ví (logic thuần ở utils/financePeriod). Chưa có "số dư đầu kỳ".
  const accountBalances = useMemo(() => accountBalancesUtil(transactions), [transactions]);

  // Chuỗi 12 tháng gần nhất cho biểu đồ xu hướng (mọi giao dịch, không theo bộ lọc)
  const trendPoints = useMemo(() => monthlySeries(transactions, 12), [transactions]);
  const trendHasData = useMemo(() => trendPoints.some(p => p.income > 0 || p.expense > 0), [trendPoints]);

  // Xuất danh sách giao dịch (theo bộ lọc đang xem) ra file CSV (mở được bằng Excel).
  const exportTransactionsCsv = () => {
    const header = [t("finance.csvColDate"), t("finance.csvColType"), t("finance.csvColCat"), t("finance.csvColWallet"), t("finance.csvColAmount"), t("finance.csvColDesc"), t("finance.csvColCreator")];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = filteredTransactions.map(tx => {
      const creator = users.find(u => u.id === tx.creatorId);
      return [
        tx.date,
        tx.type === "income" ? t("finance.csvIncome") : t("finance.csvExpense"),
        translateCategory(tx.category),
        translateAccount(tx.account),
        String(tx.amount),
        tx.description,
        creator?.fullName || ""
      ].map(esc).join(",");
    });
    // Thêm BOM để Excel nhận đúng UTF-8 tiếng Việt.
    const csv = "﻿" + [header.map(esc).join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thu-chi_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Xuất báo cáo PDF của KỲ đang xem (toàn kỳ, không áp bộ lọc chi tiết).
  // pdfmake được lazy-load trong utils/pdfExport — chỉ tải khi bấm nút.
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportReportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const { exportFinanceReportPdf } = await import("../utils/pdfExport.js");
      await exportFinanceReportPdf({
        periodLabel: tPeriodLabel(periodMode, anchor),
        totals: metrics,
        byCategory: Object.entries(curCatMap)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, amount]) => ({ label: translateCategory(cat), amount })),
        // Nhãn thuần chữ (không emoji) — font PDF không có glyph emoji
        accountBalances: [
          { key: "cash",     label: t("accounts.cash") },
          { key: "bank",     label: t("accounts.bank") },
          { key: "e_wallet", label: t("accounts.e_wallet") }
        ].map(a => ({ label: a.label, amount: accountBalances[a.key] || 0 })),
        transactions: [...periodTx]
          .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""))
          .map(tx => ({
            date: tx.date,
            type: tx.type as "income" | "expense",
            category: translateCategory(tx.category),
            account: translateAccount(tx.account),
            amount: tx.amount,
            description: tx.description,
            creator: users.find(u => u.id === tx.creatorId)?.fullName || ""
          })),
        generatedBy: currentUser.fullName
      });
    } catch (e) {
      console.error("Xuất PDF thất bại:", e);
    } finally {
      setExportingPdf(false);
    }
  };

  // Khóa tháng của mốc đang xem (ngân sách vốn đặt theo tháng)
  const anchorMonthKey = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`;
  const periodMonthsList = useMemo(() => periodMonths(periodMode, anchor), [periodMode, anchor]);

  // Chế độ Tháng: ngân sách của đúng tháng đó (giữ id để sửa/xóa)
  const monthBudgets = useMemo(
    () => budgets.filter(b => b.month === anchorMonthKey),
    [budgets, anchorMonthKey]
  );

  // Tự mang ngân sách sang THÁNG HIỆN TẠI (theo lịch thật) khi tháng mới chưa có
  // hạn mức nào nhưng tháng trước đã đặt — đỡ phải nhập lại mỗi đầu tháng.
  const realMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const carriedRef = useRef(false);
  useEffect(() => {
    if (carriedRef.current) return;
    if (!canAccessFinance(currentUser.role) || budgets.length === 0) return;
    if (budgets.some(b => b.month === realMonthKey)) { carriedRef.current = true; return; }
    if (budgets.some(b => b.month < realMonthKey)) {
      carriedRef.current = true;
      onCarryForwardBudgets(realMonthKey);
    }
  }, [budgets, currentUser.role, realMonthKey, onCarryForwardBudgets]);
  // Chế độ Quý/Năm: gộp hạn mức các tháng trong kỳ theo hạng mục (chỉ xem)
  const aggregatedBudgets = useMemo(() => {
    const map = new Map<string, number>();
    budgets
      .filter(b => periodMonthsList.includes(b.month))
      .forEach(b => map.set(b.category, (map.get(b.category) || 0) + b.limit));
    return Array.from(map, ([category, limit]) => ({ category, limit }));
  }, [budgets, periodMonthsList]);

  // Đã chi theo hạng mục trong kỳ (đối chiếu với hạn mức ngân sách)
  const budgetUsage = useMemo(() => {
    const spent: Record<string, number> = {};
    periodTx
      .filter(tx => tx.type === "expense")
      .forEach(tx => { spent[tx.category] = (spent[tx.category] || 0) + tx.amount; });
    return spent;
  }, [periodTx]);

  // Group by category to build the visual Chart distribution
  const chartCategoryDistribution = useMemo(() => {
    const list: Record<string, number> = {};
    // Calculate only for "expenses" in the current active month/year or overall filtered set to make it responsive
    filteredTransactions.filter(tx => tx.type === "expense").forEach(tx => {
      list[tx.category] = (list[tx.category] || 0) + tx.amount;
    });

    return Object.entries(list).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredTransactions]);

  // Optimize the receipt photo in the browser, then store it as a file (DB keeps only the URL).
  const uploadReceiptFile = async (file: File) => {
    setFormError("");
    setReceiptProcessing(true);
    try {
      const uploaded = await optimizeAndUpload(file, "receipts", {
        maxSourceBytes: 20 * 1024 * 1024,
        targetBytes: 600 * 1024,
        maxSizes: [1280, 1024, 768],
        qualities: [0.82, 0.72, 0.62],
        backgroundColor: "#ffffff"
      });
      setFormReceiptBase64(uploaded.url);
    } catch (err: any) {
      setFormError(err.message || t("finance.errImageProcess"));
    } finally {
      setReceiptProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadReceiptFile(file);
  };

  // Dán ảnh hóa đơn từ clipboard (Ctrl+V) khi form thu chi đang mở.
  const handleReceiptPaste = (e: React.ClipboardEvent) => {
    const img = Array.from(e.clipboardData?.items || [])
      .find(it => it.kind === "file" && it.type.startsWith("image/"))
      ?.getAsFile();
    if (!img || receiptProcessing) return;
    e.preventDefault();
    void uploadReceiptFile(img);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (formAmount <= 0) {
      setFormError(t("finance.errAmountZero"));
      return;
    }
    if (!formDesc.trim()) {
      setFormError(t("finance.errDescRequired"));
      return;
    }

    const payload: Partial<FinancialTransaction> = {
      // Có editingTx = đang sửa: gửi kèm id để server UPDATE thay vì tạo mới
      ...(editingTx ? { id: editingTx.id, createdAt: editingTx.createdAt } : {}),
      type: formType,
      amount: Number(formAmount),
      category: formCategory,
      account: formAccount,
      description: formDesc.trim(),
      date: formDate,
      receiptImage: formReceiptBase64 || undefined
    };

    try {
      await onSaveTransaction(payload);
      // Reset
      setFormAmount(0);
      setFormDesc("");
      setFormReceiptBase64("");
      setFormDate(new Date().toISOString().slice(0, 10));
      setEditingTx(null);
      setIsFormOpen(false);
    } catch (err: any) {
      setFormError(err.message || t("finance.errSaveTx"));
    }
  };

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setBudgetError("");
    if (budgetLimit <= 0) {
      setBudgetError(t("finance.errBudgetZero"));
      return;
    }
    try {
      await onSaveBudget({ month: anchorMonthKey, category: budgetCategory, limit: Number(budgetLimit) });
      setBudgetLimit(0);
    } catch (err: any) {
      setBudgetError(err.message || t("finance.errSaveBudget"));
    }
  };

  const startEditBudget = (b: BudgetLimit) => {
    setEditingBudgetId(b.id);
    setEditingBudgetLimit(b.limit);
  };

  const saveEditBudget = async (b: BudgetLimit) => {
    if (editingBudgetLimit <= 0) return;
    try {
      await onSaveBudget({ id: b.id, month: b.month, category: b.category, limit: Number(editingBudgetLimit) });
      setEditingBudgetId(null);
    } catch {
      /* giữ nguyên ô sửa nếu lỗi */
    }
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillError("");
    if (!billTitle.trim() || billAmount <= 0) {
      setBillError(t("finance.errBillInvalid"));
      return;
    }
    try {
      await onSaveRecurringBill({
        title: billTitle.trim(),
        amount: Number(billAmount),
        category: billCategory,
        account: AccountType.BANK,
        frequency: billFrequency,
        nextDueDate: billDueDate,
        isActive: true
      });
      setBillTitle("");
      setBillAmount(0);
    } catch (err: any) {
      setBillError(err.message || t("finance.errSaveBill"));
    }
  };

  const handleOpenEditBill = (b: RecurringBill) => {
    setEditingBill(b);
    setEditTitle(b.title);
    setEditAmount(b.amount);
    setEditCategory(b.category);
    setEditFrequency(b.frequency);
    setEditDueDate(b.nextDueDate);
    setEditError("");
  };

  const handleSaveEditBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBill) return;
    setEditError("");
    if (!editTitle.trim() || editAmount <= 0) {
      setEditError(t("finance.errEditInvalid"));
      return;
    }
    try {
      await onSaveRecurringBill({
        id: editingBill.id,
        title: editTitle.trim(),
        amount: Number(editAmount),
        category: editCategory,
        frequency: editFrequency,
        nextDueDate: editDueDate,
      });
      setEditingBill(null);
    } catch (err: any) {
      setEditError(err.message || t("finance.errSaveEdit"));
    }
  };

  const handleDeleteClick = async (txId: string) => {
    const ok = await confirm({
      title: t("finance.deleteTxTitle"),
      message: t("finance.deleteTxMsg"),
      confirmLabel: t("finance.deleteTxConfirm"),
      tone: "danger"
    });
    if (ok) {
      await onDeleteTransaction(txId);
    }
  };

  // Naming converters
  // Nhãn hạng mục dùng chung namespace "categories"; hạng mục tự đặt giữ tên gốc.
  const translateCategory = (cat: string) => t(`categories.${cat}`, { defaultValue: cat });

  const translateAccount = (acc: string) => {
    switch (acc) {
      case "cash": return t("accounts.cashEmoji");
      case "bank": return t("accounts.bankEmoji");
      case "e_wallet": return t("accounts.eWalletEmoji");
      default: return acc;
    }
  };

  const categoryColorClass = (cat: string) => {
    switch (cat) {
      case "food":          return "text-orange-400 bg-orange-500/10";
      case "education2":    return "text-violet-400 bg-violet-500/10";
      case "utilities":     return "text-amber-400 bg-amber-500/10";
      case "shopping":      return "text-pink-400 bg-pink-500/10";
      case "medical":       return "text-rose-400 bg-rose-500/10";
      case "transport":     return "text-sky-400 bg-sky-500/10";
      case "debt_bank":
      case "loan":          return "text-red-400 bg-red-500/10";
      case "debt_personal": return "text-teal-400 bg-teal-500/10";
      case "funeral":       return "text-zinc-400 bg-zinc-500/15";
      case "ceremony":      return "text-yellow-400 bg-yellow-500/10";
      case "rent":          return "text-indigo-400 bg-indigo-500/10";
      case "internet":      return "text-cyan-400 bg-cyan-500/10";
      case "phone":         return "text-purple-400 bg-purple-500/10";
      case "insurance":     return "text-slate-300 bg-slate-700/40";
      default:              return "text-slate-400 bg-slate-800";
    }
  };

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case "food":          return <Utensils className="w-4 h-4" />;
      case "education2":    return <GraduationCap className="w-4 h-4" />;
      case "utilities":     return <Zap className="w-4 h-4" />;
      case "shopping":      return <ShoppingCart className="w-4 h-4" />;
      case "medical":       return <HeartPulse className="w-4 h-4" />;
      case "transport":     return <Car className="w-4 h-4" />;
      case "debt_bank":
      case "loan":          return <Landmark className="w-4 h-4" />;
      case "debt_personal": return <Users className="w-4 h-4" />;
      case "funeral":       return <Flower2 className="w-4 h-4" />;
      case "ceremony":      return <Gift className="w-4 h-4" />;
      case "rent":          return <Home className="w-4 h-4" />;
      case "internet":      return <Wifi className="w-4 h-4" />;
      case "phone":         return <Phone className="w-4 h-4" />;
      case "insurance":     return <Shield className="w-4 h-4" />;
      default:              return <HelpCircle className="w-4 h-4" />;
    }
  };

  // Huy hiệu ± so với kỳ trước. higherIsGood=true (thu): tăng = tốt (xanh);
  // false (chi): tăng = xấu (đỏ).
  const DeltaBadge = ({ cur, prev, higherIsGood }: { cur: number; prev: number; higherIsGood: boolean }) => {
    const d = pctDelta(cur, prev);
    if (d === 0) return <span className="text-[10px] text-slate-500 font-mono">— {t("finance.vsPrev")}</span>;
    const up = d > 0;
    const good = higherIsGood ? up : !up;
    return (
      <span className={`text-[10px] font-mono font-bold ${good ? "text-emerald-400" : "text-rose-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(d)}% <span className="text-slate-500 font-normal">{t("finance.vsPrev")}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6" id="finance-module">
      <Reveal className="bg-slate-950 neu-pressed-sm rounded-2xl p-1.5 flex flex-col sm:flex-row gap-1.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => setFinanceView("cashflow")}
          className={`flex-1 px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-[box-shadow,color] duration-200 ${financeView === "cashflow" ? "bg-slate-900 neu-raised-sm text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Wallet className="w-4 h-4" /> {t("finance.tabTransactions")}
        </button>
        <button
          type="button"
          onClick={() => setFinanceView("assets")}
          className={`flex-1 px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-[box-shadow,color] duration-200 ${financeView === "assets" ? "bg-slate-900 neu-raised-sm text-amber-400" : "text-slate-400 hover:text-slate-200"}`}
        >
          <FileText className="w-4 h-4" /> {t("finance.tabAssets")}
        </button>
      </Reveal>

      {financeView === "assets" ? (
        <Assets
          currentUser={currentUser}
          users={users}
          assets={assets}
          widgets={widgets}
          onSaveAsset={onSaveAsset}
          onDeleteAsset={onDeleteAsset}
          onSaveTransaction={onSaveTransaction}
        />
      ) : (
        <>
      {/* Period control: chọn chế độ kỳ + điều hướng kỳ + bật so sánh */}
      <Reveal delay={0.06} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-3 space-y-3" id="finance-period">
        <ShimmerLine accent="sky" />
        <div className="flex items-center gap-2">
          <div className="flex-1 grid grid-cols-3 gap-1.5 text-[11px] font-bold">
            {(["month", "quarter", "year"] as PeriodMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setPeriodMode(m)}
                className={`py-2 rounded-xl transition-all duration-150 cursor-pointer active:scale-95 active:brightness-90 ${periodMode === m ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/30" : "bg-slate-900 neu-raised-sm text-slate-400 hover:text-slate-200"}`}
              >
                {tPeriodMode(m)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowCompare(s => !s)}
            className={`flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold transition-[box-shadow,color] duration-200 cursor-pointer ${showCompare ? "bg-slate-900 neu-raised-sm text-violet-400" : "bg-slate-950 neu-pressed-sm text-slate-400 hover:text-slate-200"}`}
            title={t("finance.compare")}
          >
            <BarChart3 className="w-3.5 h-3.5" /> {t("finance.compare")}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setAnchor(a => stepAnchor(periodMode, a, -1))}
            className="p-2 rounded-xl bg-slate-950 neu-btn text-slate-300 hover:text-sky-400 transition-colors cursor-pointer"
            title={t("finance.prevPeriod")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="text-center min-w-0">
            <p className="text-lg md:text-xl font-extrabold text-slate-100 truncate tracking-tight">{tPeriodLabel(periodMode, anchor)}</p>
            {!isCurrentPeriod ? (
              <button
                type="button"
                onClick={() => setAnchor(new Date())}
                className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> {t("finance.backToCurrent")}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> {t("finance.currentPeriod")}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => canGoNext && setAnchor(a => stepAnchor(periodMode, a, 1))}
            disabled={!canGoNext}
            className="p-2 rounded-xl bg-slate-950 neu-btn text-slate-300 hover:text-sky-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-300"
            title={t("finance.nextPeriod")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </Reveal>

      {/* Wallet Cards Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-y-4 md:gap-x-6" id="finance-summaries">

        {/* Cân đối trong kỳ (Thu − Chi) */}
        <Reveal delay={0.1} className="relative overflow-hidden bg-slate-900 neu-raised p-5 rounded-2xl flex flex-col justify-between">
          <ShimmerLine via={metrics.balance >= 0 ? "via-emerald-500/50" : "via-rose-500/50"} />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold">{t("finance.balanceThisPeriod")}</span>
            <div className={`p-2 rounded-xl ${metrics.balance >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <h3 className={`text-2xl md:text-3xl font-extrabold font-sans tracking-tight ${metrics.balance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {metrics.balance >= 0 ? "+" : ""}{metrics.balance.toLocaleString()} VNĐ
            </h3>
            <DeltaBadge cur={metrics.balance} prev={prevMetrics.balance} higherIsGood={true} />
          </div>
        </Reveal>

        {/* Thu nhập trong kỳ */}
        <Reveal delay={0.15} className="relative overflow-hidden bg-slate-900 neu-raised p-5 rounded-2xl shadow-md flex flex-col justify-between">
          <ShimmerLine accent="emerald" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold">{t("finance.incomeThisPeriod")}</span>
            <div className="bg-emerald-500/10 p-2 rounded-xl text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <h3 className="text-2xl font-extrabold text-slate-100 font-sans tracking-tight">
              +{metrics.totalIncome.toLocaleString()} VNĐ
            </h3>
            <DeltaBadge cur={metrics.totalIncome} prev={prevMetrics.totalIncome} higherIsGood={true} />
          </div>
        </Reveal>

        {/* Chi tiêu trong kỳ */}
        <Reveal delay={0.2} className="relative overflow-hidden bg-slate-900 neu-raised p-5 rounded-2xl shadow-md flex flex-col justify-between">
          <ShimmerLine accent="rose" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold">{t("finance.expenseThisPeriod")}</span>
            <div className="bg-rose-500/10 p-2 rounded-xl text-rose-400">
              <ArrowDownRight className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <h3 className="text-2xl font-extrabold text-slate-100 font-sans tracking-tight">
              -{metrics.totalExpense.toLocaleString()} VNĐ
            </h3>
            <DeltaBadge cur={metrics.totalExpense} prev={prevMetrics.totalExpense} higherIsGood={false} />
          </div>
        </Reveal>
      </div>

      {/* Số dư theo từng ví (tính từ giao dịch) */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 md:gap-x-6" id="account-balances">
        {[
          { key: "cash", label: t("finance.walletCash") },
          { key: "bank", label: t("finance.walletBank") },
          { key: "e_wallet", label: t("finance.walletEWallet") }
        ].map(acc => {
          const v = accountBalances[acc.key] || 0;
          return (
            <div key={acc.key} className="bg-slate-900 neu-raised rounded-2xl p-3 sm:p-4 min-w-0">
              <span className="block text-[10px] text-slate-500 font-semibold truncate">{acc.label}</span>
              <span className={`block mt-1 text-[13px] sm:text-lg font-extrabold font-sans tabular-nums leading-tight break-words ${v >= 0 ? "text-slate-100" : "text-rose-400"}`}>
                {v.toLocaleString()} đ
              </span>
            </div>
          );
        })}
      </div>

      {/* Nhóm "So sánh" (bật/tắt bằng nút So sánh): biểu đồ xu hướng 12 tháng +
          bảng so sánh kỳ — desktop nằm ngang hàng 2 cột cho đỡ tốn diện tích */}
      {showCompare && (
        <div className={`grid grid-cols-1 gap-4 ${trendHasData ? "xl:grid-cols-2" : ""}`} id="finance-compare-group">
          {trendHasData && (
            <div className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-4 flex flex-col gap-2" id="finance-trend-chart">
              <ShimmerLine accent="emerald" />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Xu hướng 12 tháng
                </h3>
                <div className="flex items-center gap-3 text-[10px] text-slate-400 font-semibold">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> Thu</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-400 inline-block" /> Chi</span>
                </div>
              </div>
              {/* flex-1 + căn giữa: hai thẻ trong grid cao bằng nhau, chart nằm giữa khoảng trống */}
              <div className="flex-1 flex items-center">
                <MonthlyTrendChart points={trendPoints} />
              </div>
            </div>
          )}

          <div className="bg-slate-900 neu-raised rounded-2xl p-4 space-y-2" id="finance-compare">
          <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-violet-400" />
            {t("finance.compare")}: {tPeriodLabel(periodMode, anchor)} ↔ {tPeriodLabel(periodMode, prevAnchor)}
          </h3>
          {/* Chiều cao cố định vừa phải — nội dung dài thì cuộn bên trong, không kéo
              giãn cả hàng làm thẻ Xu hướng 12 tháng bên cạnh trống trải */}
          <div className="overflow-x-auto overflow-y-auto max-h-72 overscroll-contain scrollbar-thin -mx-1 px-1">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-800">
                  <th className="text-left font-semibold py-2 pr-2">{t("finance.compareColCat")}</th>
                  <th className="text-right font-semibold py-2 px-2 whitespace-nowrap">{tPeriodLabel(periodMode, anchor)}</th>
                  <th className="text-right font-semibold py-2 px-2 whitespace-nowrap">{tPeriodLabel(periodMode, prevAnchor)}</th>
                  <th className="text-right font-semibold py-2 pl-2">{t("finance.compareColDiff")}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {([
                  { label: t("finance.compareTotalIncome"), cur: metrics.totalIncome, prev: prevMetrics.totalIncome, higherIsGood: true },
                  { label: t("finance.compareTotalExpense"), cur: metrics.totalExpense, prev: prevMetrics.totalExpense, higherIsGood: false },
                  { label: t("finance.compareBalance"), cur: metrics.balance, prev: prevMetrics.balance, higherIsGood: true }
                ]).map(row => {
                  const diff = row.cur - row.prev;
                  const good = row.higherIsGood ? diff >= 0 : diff <= 0;
                  return (
                    <tr key={row.label} className="border-b border-slate-850 font-sans">
                      <td className="py-2 pr-2 font-bold text-slate-200">{row.label}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-200">{row.cur.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-400">{row.prev.toLocaleString()}</td>
                      <td className={`py-2 pl-2 text-right tabular-nums font-bold ${diff === 0 ? "text-slate-500" : good ? "text-emerald-400" : "text-rose-400"}`}>
                        {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                {compareCatKeys.length > 0 && (
                  <tr>
                    <td colSpan={4} className="pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-sans">{t("finance.compareCatDetail")}</td>
                  </tr>
                )}
                {compareCatKeys.map(cat => {
                  const cur = curCatMap[cat] || 0;
                  const prev = prevCatMap[cat] || 0;
                  const diff = cur - prev;
                  return (
                    <tr key={cat} className="border-b border-slate-850 font-sans">
                      <td className="py-1.5 pr-2 text-slate-300">{translateCategory(cat)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">{cur.toLocaleString()}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{prev.toLocaleString()}</td>
                      <td className={`py-1.5 pl-2 text-right tabular-nums font-semibold ${diff === 0 ? "text-slate-500" : diff <= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-500">{t("finance.compareHint")}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" id="finance-planning">
        <Reveal delay={0.1} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-4">
          <ShimmerLine accent="sky" />
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200">{t("finance.budgetTitle")} {tPeriodLabel(periodMode, anchor)}</h3>
            <span className="text-[10px] text-slate-500 font-mono">
              {t("finance.budgetHintLimitCount", { n: periodMode === "month" ? monthBudgets.length : aggregatedBudgets.length })}
            </span>
          </div>

          {periodMode === "month" ? (
            <>
              <form onSubmit={handleCreateBudget} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 text-xs">
                <FancySelect
                  value={budgetCategory}
                  onChange={setBudgetCategory}
                  ariaLabel={t("finance.budgetCatAriaLabel")}
                  options={expenseCategoryOptions}
                />
                <MoneyInput
                  value={budgetLimit}
                  onChange={setBudgetLimit}
                  placeholder={t("finance.budgetLimitPlaceholder")}
                  className="w-full bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none"
                />
                <button type="submit" className="bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl px-3 py-2 font-bold">
                  {t("common.save")}
                </button>
              </form>
              {budgetError && <p className="text-[11px] text-rose-400">{budgetError}</p>}
            </>
          ) : (
            <p className="text-[11px] text-slate-500 bg-slate-950/60 neu-pressed-sm rounded-xl px-3 py-2">
              {t("finance.budgetPeriodHint", { n: periodMonthsList.length })}
            </p>
          )}

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 -mr-1 scrollbar-thin">
            {periodMode === "month" ? (
              monthBudgets.length === 0 ? (
                <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">{t("finance.budgetEmptyMonth")}</p>
              ) : monthBudgets.map(b => {
                const used = budgetUsage[b.category] || 0;
                const pct = Math.min(100, Math.round((used / b.limit) * 100));
                const isEditing = editingBudgetId === b.id;
                return (
                  <div key={b.id} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="flex items-center gap-1.5 min-w-0 font-bold text-slate-200">
                        <span className={`shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 ${catBar(b.category).text}`}>{categoryIcon(b.category)}</span>
                        <span className="truncate">{translateCategory(b.category)}</span>
                      </span>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => saveEditBudget(b)} className="text-emerald-400 hover:text-emerald-300 font-bold text-[11px]">{t("finance.budgetEditSave")}</button>
                          <button onClick={() => setEditingBudgetId(null)} className="text-slate-500 hover:text-slate-300 font-bold text-[11px]">{t("finance.budgetEditCancel")}</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => startEditBudget(b)} className="text-slate-500 hover:text-sky-400" title={t("finance.budgetEditTitle")}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onDeleteBudget(b.id)} className="text-slate-500 hover:text-rose-400" title={t("finance.budgetDeleteTitle")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <MoneyInput
                        value={editingBudgetLimit}
                        onChange={setEditingBudgetLimit}
                        autoFocus
                        placeholder={t("finance.budgetEditPlaceholder")}
                        className="w-full bg-slate-950 border border-sky-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs outline-none focus:border-sky-500"
                      />
                    ) : (
                      <>
                        <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full bg-gradient-to-r ${used > b.limit ? "from-rose-500 to-rose-400" : catBar(b.category).bar}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono">{used.toLocaleString()} / {b.limit.toLocaleString()} VNĐ</p>
                      </>
                    )}
                  </div>
                );
              })
            ) : (
              aggregatedBudgets.length === 0 ? (
                <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">{t("finance.budgetEmptyPeriod")}</p>
              ) : aggregatedBudgets.map(b => {
                const used = budgetUsage[b.category] || 0;
                const pct = Math.min(100, Math.round((used / b.limit) * 100));
                return (
                  <div key={b.category} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0 font-bold text-slate-200">
                        <span className={`shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 ${catBar(b.category).text}`}>{categoryIcon(b.category)}</span>
                        <span className="truncate">{translateCategory(b.category)}</span>
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{t("finance.budgetAggMonths", { n: periodMonthsList.length })}</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full bg-gradient-to-r ${used > b.limit ? "from-rose-500 to-rose-400" : catBar(b.category).bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono">{used.toLocaleString()} / {b.limit.toLocaleString()} VNĐ</p>
                  </div>
                );
              })
            )}
          </div>
        </Reveal>

        <Reveal delay={0.16} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-4">
          <ShimmerLine accent="emerald" />
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200">{t("finance.billTitle")}</h3>
            <span className="text-[10px] text-slate-500 font-mono">{t("finance.billCount", { n: recurringBills.length })}</span>
          </div>
          <form onSubmit={handleCreateBill} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <input value={billTitle} onChange={(e) => setBillTitle(e.target.value)} placeholder={t("finance.billNamePlaceholder")} className="bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none" />
            <input type="text" inputMode="numeric" value={formatMoneyInput(billAmount)} onChange={(e) => setBillAmount(parseMoneyInput(e.target.value))} placeholder={t("finance.billAmountPlaceholder")} className="bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none" />
            <DateInputDMY value={billDueDate} onChange={setBillDueDate} className="bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none font-mono" />
            <FancySelect
              value={billFrequency}
              onChange={(v) => setBillFrequency(v as RecurringBill["frequency"])}
              ariaLabel={t("finance.billFreqAriaLabel")}
              options={billFrequencyOptions}
            />
            <FancySelect
              value={billCategory}
              onChange={setBillCategory}
              ariaLabel={t("finance.billCatAriaLabel")}
              options={billCategoryOptions}
            />
            <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl px-3 py-2 font-bold">{t("common.save")}</button>
          </form>
          {billError && <p className="text-[11px] text-rose-400">{billError}</p>}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 -mr-1 scrollbar-thin">
            {recurringBills.length === 0 ? (
              <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">{t("finance.billEmpty")}</p>
            ) : recurringBills.map(b => (
              <div key={b.id} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-200 truncate">{b.title}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{b.amount.toLocaleString()} VNĐ • {translateBillCategory(b.category)} • hạn {formatDateVN(b.nextDueDate)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isAlreadyPaidThisPeriod(b) ? (
                    <span className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg text-[10px] font-bold">
                      <CheckCircle2 className="w-3 h-3" /> {t("finance.billPaid")}
                    </span>
                  ) : (
                    <button
                      onClick={() => onPayRecurringBill(b.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg text-[10px] font-bold hover:bg-sky-500/20 transition-colors cursor-pointer"
                    >
                      <CreditCard className="w-3 h-3" /> {payButtonLabel(b.frequency)}
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenEditBill(b)}
                    className="p-1.5 text-slate-500 hover:text-sky-400 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: t("finance.billDeleteTitle"),
                        message: t("finance.billDeleteMsg"),
                        confirmLabel: t("finance.billDeleteConfirm"),
                        tone: "danger"
                      });
                      if (ok) onDeleteRecurringBill(b.id);
                    }}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      {/* Mục tiêu tiết kiệm + Vay/cho mượn — desktop nằm ngang hàng cho gọn;
          items-start để mỗi thẻ cao theo nội dung riêng (danh sách dài ngắn khác nhau) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start" id="finance-savings-debts">
        <SavingsGoals
          currentUser={currentUser}
          users={users}
          savingsGoals={savingsGoals}
          onSaveSavingsGoal={onSaveSavingsGoal}
          onDeleteSavingsGoal={onDeleteSavingsGoal}
          onContributeSavings={onContributeSavings}
          onRemoveSavingsContribution={onRemoveSavingsContribution}
        />

        <DebtTracker
          currentUser={currentUser}
          users={users}
          debts={debts}
          onSaveDebt={onSaveDebt}
          onDeleteDebt={onDeleteDebt}
          onAddDebtPayment={onAddDebtPayment}
          onRemoveDebtPayment={onRemoveDebtPayment}
        />
      </div>

      {/* Advanced charts & breakdowns layout */}
      {chartCategoryDistribution.length > 0 && (
        <div className="relative overflow-hidden bg-slate-900 neu-raised p-5 rounded-2xl shadow-xl grid grid-cols-1 md:grid-cols-2 gap-6" id="finance-statistics">
          <ShimmerLine accent="violet" />
          
          {/* Phân hóa hạng mục: thanh gradient màu theo hạng mục, track lõm, chạy mượt khi hiện */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>{t("finance.compareCatDetail")}</span>
            </h4>
            <div className="space-y-3 max-h-[190px] overflow-y-auto pr-1">
              {chartCategoryDistribution.map(({ name, value }, i) => {
                const percentage = Math.round((value / metrics.totalExpense) * 100) || 0;
                const c = catBar(name);
                return (
                  <div key={name} className="space-y-1 font-sans text-xs">
                    <div className="flex justify-between items-center gap-2 font-medium pb-0.5">
                      <span className="flex items-center gap-1.5 min-w-0 text-slate-300">
                        <span className={`shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 ${c.text}`}>{categoryIcon(name)}</span>
                        <span className="truncate">{translateCategory(name)}</span>
                        {i === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold shrink-0">Cao nhất</span>}
                      </span>
                      <span className="font-mono text-slate-400 shrink-0">{value.toLocaleString()}đ <span className={`font-bold ${c.text}`}>({percentage}%)</span></span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-950 neu-pressed-sm rounded-full overflow-hidden">
                      <motion.div
                        initial={reduceMotion ? false : { width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.7, ease: "easeOut", delay: 0.04 * i }}
                        className={`h-full rounded-full bg-gradient-to-r ${c.bar}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cán cân Thu/Chi: donut bo cung + khe hở, tâm hiện số dư ròng, legend có số */}
          {(() => {
            const total = metrics.totalIncome + metrics.totalExpense;
            const C = 2 * Math.PI * 38;                       // chu vi vòng r=38
            const net = metrics.balance;
            const incPct = total > 0 ? Math.round((metrics.totalIncome / total) * 100) : 0;
            const expPct = total > 0 ? 100 - incPct : 0;
            const savingsRate = metrics.totalIncome > 0 ? Math.round((net / metrics.totalIncome) * 100) : 0;
            const bothSides = metrics.totalIncome > 0 && metrics.totalExpense > 0;
            const gap = bothSides ? 12 : 0;                   // khe hở giữa 2 cung (bù cho bo tròn đầu)
            const incLen = total > 0 ? Math.max(0, (metrics.totalIncome / total) * C - gap) : 0;
            const expLen = total > 0 ? Math.max(0, (metrics.totalExpense / total) * C - gap) : 0;
            return (
              <div className="flex flex-col items-center justify-center gap-4 bg-slate-950/40 neu-pressed-sm p-4 rounded-xl">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t("finance.chartBalanceLabel")}</span>
                <div className="relative w-36 h-36">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="38" fill="none" strokeWidth="8" className="stroke-slate-800" />
                    {total > 0 && (
                      <>
                        {incLen > 0 && (
                          <circle
                            cx="50" cy="50" r="38" fill="none" strokeWidth="8" strokeLinecap="round"
                            className="stroke-emerald-500"
                            strokeDasharray={`${incLen} ${C}`}
                            strokeDashoffset={`-${gap / 2}`}
                          />
                        )}
                        {expLen > 0 && (
                          <circle
                            cx="50" cy="50" r="38" fill="none" strokeWidth="8" strokeLinecap="round"
                            className="stroke-rose-500"
                            strokeDasharray={`${expLen} ${C}`}
                            strokeDashoffset={`-${gap / 2 + incLen + gap}`}
                          />
                        )}
                      </>
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Số dư</span>
                    <span className={`text-base font-extrabold font-mono leading-tight ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {net >= 0 ? "+" : "−"}{fmtShortMoney(Math.abs(net))}
                    </span>
                    {metrics.totalIncome > 0 && (
                      <span className="text-[9px] text-slate-500 font-mono mt-0.5">Tiết kiệm {savingsRate}%</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 w-full text-[10px] font-mono">
                  <span className="flex items-center gap-1.5 justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0" />
                    <span className="text-slate-400">Thu</span>
                    <span className="text-emerald-400 font-bold">{fmtShortMoney(metrics.totalIncome)}</span>
                    <span className="text-slate-500">({incPct}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5 justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shrink-0" />
                    <span className="text-slate-400">Chi</span>
                    <span className="text-rose-400 font-bold">{fmtShortMoney(metrics.totalExpense)}</span>
                    <span className="text-slate-500">({expPct}%)</span>
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Query Filters blocks and create triggers row */}
      <div className="relative overflow-hidden bg-slate-900 neu-raised p-4.5 rounded-2xl shadow-xl space-y-3" id="finance-filters">
        <ShimmerLine accent="emerald" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-500" />
            <input
              type="text"
              placeholder={t("finance.filterSearch")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 neu-pressed-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-slate-200 placeholder-slate-500 text-xs focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Filters lists */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 text-[11px]">
          <div>
            <label className="text-slate-500 block mb-1">{t("finance.filterTypeLbl")}</label>
            <FancySelect
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as any)}
              ariaLabel={t("finance.filterTypeAriaLabel")}
              options={[
                { value: "all",     label: t("finance.filterTypeAll") },
                { value: "income",  label: t("finance.filterTypeIncome") },
                { value: "expense", label: t("finance.filterTypeExpense") }
              ]}
            />
          </div>

          <div>
            <label className="text-slate-500 block mb-1">{t("finance.filterCatLbl")}</label>
            <FancySelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              ariaLabel={t("finance.filterCatAriaLabel")}
              options={[
                { value: "all", label: t("finance.filterCatAll") },
                ...expenseCategoryOptions,
                { value: "Bán tài sản", label: t("finance.filterCatAssetSale") }
              ]}
            />
          </div>

          <div>
            <label className="text-slate-500 block mb-1">{t("finance.filterAccountLbl")}</label>
            <FancySelect
              value={accountFilter}
              onChange={setAccountFilter}
              ariaLabel={t("finance.filterAccountAriaLabel")}
              options={[
                { value: "all",      label: t("finance.filterAccountAll") },
                { value: "cash",     label: t("accounts.cashEmoji") },
                { value: "bank",     label: t("accounts.bankEmoji") },
                { value: "e_wallet", label: t("accounts.eWalletEmoji") }
              ]}
            />
          </div>

          <div>
            <label className="text-slate-500 block mb-1">{t("finance.filterMemberLbl")}</label>
            <FancySelect
              value={memberFilter}
              onChange={setMemberFilter}
              ariaLabel={t("finance.filterMemberAriaLabel")}
              options={[
                { value: "all", label: t("finance.filterMemberAll") },
                ...users.map(u => ({ value: u.id, label: u.fullName }))
              ]}
            />
          </div>
        </div>
      </div>

      {/* Transactions Details List */}
      {filteredTransactions.length === 0 ? (
        <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl py-12 text-center" id="empty-transactions">
          <p className="text-sm text-slate-500">
            {t("finance.txListEmpty", { period: tPeriodLabel(periodMode, anchor) })}
          </p>
        </div>
      ) : (
        <div className="relative bg-slate-900 neu-raised rounded-2xl overflow-hidden" id="transactions-table">
          <ShimmerLine accent="sky" />
          <div className="bg-slate-950 p-4 border-b border-slate-800 text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between items-center gap-2">
            <span>{t("finance.txListHeader", { period: tPeriodLabel(periodMode, anchor), count: filteredTransactions.length })}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={exportTransactionsCsv}
                className="flex items-center gap-1 normal-case bg-slate-900 hover:bg-slate-800 neu-btn text-sky-400 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
                title={t("finance.exportCsvTitle")}
              >
                <FileText className="w-3.5 h-3.5" /> {t("finance.exportCsv")}
              </button>
              <button
                type="button"
                onClick={exportReportPdf}
                disabled={exportingPdf}
                className="flex items-center gap-1 normal-case bg-slate-900 hover:bg-slate-800 neu-btn text-indigo-400 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-60"
                title={t("finance.exportPdfTitle")}
              >
                <FileDown className="w-3.5 h-3.5" /> {exportingPdf ? t("finance.exportingPdf") : t("finance.exportPdf")}
              </button>
            </div>
          </div>

          {/* Chú thích màu sắc icon */}
          <div className="px-4 py-2.5 border-b border-slate-800/60 bg-slate-950/50 overflow-x-auto">
            <div className="flex items-center gap-3 min-w-max text-[10px] font-semibold">
              <span className="text-slate-600 uppercase tracking-wider shrink-0">{t("finance.iconLegendLabel")}</span>
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> {t("finance.iconLegendIncome")}</span>
              <span className="w-px h-3 bg-slate-800" />
              <span className="flex items-center gap-1 text-orange-400"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> {t("categories.food")}</span>
              <span className="flex items-center gap-1 text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> {t("categories.utilities")}</span>
              <span className="flex items-center gap-1 text-pink-400"><span className="w-2 h-2 rounded-full bg-pink-400 inline-block" /> {t("categories.shopping")}</span>
              <span className="flex items-center gap-1 text-rose-400"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> {t("categories.medical")}</span>
              <span className="flex items-center gap-1 text-sky-400"><span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> {t("categories.transport")}</span>
              <span className="flex items-center gap-1 text-violet-400"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> {t("categories.education2")}</span>
              <span className="flex items-center gap-1 text-indigo-400"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> {t("categories.rent")}</span>
              <span className="flex items-center gap-1 text-cyan-400"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> {t("categories.internet")}</span>
              <span className="flex items-center gap-1 text-purple-400"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> {t("categories.phone")}</span>
              <span className="flex items-center gap-1 text-slate-300"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /> {t("categories.insurance")}</span>
              <span className="flex items-center gap-1 text-red-400"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> {t("categories.debt_bank")}</span>
              <span className="flex items-center gap-1 text-teal-400"><span className="w-2 h-2 rounded-full bg-teal-400 inline-block" /> {t("categories.debt_personal")}</span>
              <span className="flex items-center gap-1 text-zinc-400"><span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" /> {t("categories.funeral")}</span>
              <span className="flex items-center gap-1 text-yellow-400"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> {t("categories.ceremony")}</span>
              <span className="flex items-center gap-1 text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-500 inline-block" /> {t("categories.other")}</span>
            </div>
          </div>

          <div className="divide-y divide-slate-800 max-h-[400px] overflow-y-auto">
            {filteredTransactions.map(tx => {
              const creator = users.find(u => u.id === tx.creatorId);
              const isIncome = tx.type === "income";

              return (
                <div key={tx.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between hover:bg-slate-850/40 transition-colors gap-3">
                  <div className="flex items-start gap-3.5">
                    {/* Icon chip: emerald + ArrowUpRight = THU, màu hạng mục + icon riêng = CHI */}
                    <div className={`p-2.5 rounded-xl shrink-0 ${isIncome ? "text-emerald-400 bg-emerald-500/10" : categoryColorClass(tx.category)}`}>
                      {isIncome ? <ArrowUpRight className="w-4 h-4" /> : categoryIcon(tx.category)}
                    </div>

                    <div className="space-y-1 text-xs">
                      {/* Description */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-slate-200 font-semibold text-sm leading-snug">{tx.description}</p>
                        {/* Badge THU / CHI */}
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${isIncome ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                          {isIncome ? <span className="flex items-center gap-0.5"><ArrowUpRight className="w-2.5 h-2.5" />{t("finance.txIncomeBadge")}</span> : <span className="flex items-center gap-0.5"><ArrowDownRight className="w-2.5 h-2.5" />{t("finance.txExpenseBadge")}</span>}
                        </span>
                      </div>

                      {/* Secondary descriptors */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                        {/* Date */}
                        <span className="flex items-center gap-1 font-mono text-[10px]"><Calendar className="w-3 h-3 text-slate-500" /> {formatDateVN(tx.date)}</span>
                        {/* Account */}
                        <span>{translateAccount(tx.account)}</span>
                        {/* Category tag */}
                        {!isIncome && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${categoryColorClass(tx.category)}`}>
                            {translateCategory(tx.category).split(" ")[0]}
                          </span>
                        )}
                        {isIncome && tx.category === "Bán tài sản" && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[10px] font-semibold">{t("finance.assetSaleBadge")}</span>}
                        {/* Member user */}
                        {creator && <span className="text-[10px] font-semibold text-sky-400">@{creator.username}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Right hand side action and value */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0自 mt-2 sm:mt-0 font-sans">
                    {/* Receipt handle */}
                    {tx.receiptImage ? (
                      <button 
                        onClick={() => setSelectedReceipt(tx.receiptImage!)}
                        className="flex items-center gap-1 bg-slate-950 text-sky-400 hover:bg-slate-850 neu-btn text-[10px] px-2 py-1 rounded-lg cursor-pointer"
                        title={t("finance.txViewReceiptTitle")}
                      >
                        <ImageIcon className="w-3.5 h-3.5" /> {t("finance.txViewReceiptTitle")}
                      </button>
                    ) : null}

                    {/* Monetary value block */}
                    <div className="text-right">
                      <span className={`text-base font-bold text-slate-100 ${isIncome ? "text-emerald-400 font-extrabold" : "text-rose-400 font-bold"}`}>
                        {isIncome ? "+" : "-"}{tx.amount.toLocaleString()} VNĐ
                      </span>
                    </div>

                    {/* Edit + Trash: admin hoặc chính người tạo */}
                    {(canAccessFinance(currentUser.role) && (currentUser.role === UserRole.ADMIN || tx.creatorId === currentUser.id)) && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEditTransaction(tx)}
                          className="p-1.5 bg-slate-950 neu-btn hover:text-sky-400 hover:bg-slate-800 rounded-lg text-slate-500 transition-all cursor-pointer"
                          title={t("finance.txEditTitle")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(tx.id)}
                          className="p-1.5 bg-slate-950 neu-btn hover:text-rose-450 hover:bg-slate-800 rounded-lg text-slate-500 transition-all cursor-pointer"
                          title={t("finance.txDeleteTitle")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Creation Modal Form */}
      {isFormOpen && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="finance-create-modal"
        >
          <motion.div
            ref={formRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-800 shrink-0">
              <h3 className="text-md font-bold text-slate-100 flex items-center gap-1.5">
                {editingTx
                  ? <><Pencil className="w-5 h-5 text-sky-400" /> {t("finance.formTitleEdit")}</>
                  : <><CreditCard className="w-5 h-5 text-sky-400" /> {t("finance.formTitleNew")}</>}
              </h3>
              <button
                onClick={closeForm}
                className="text-slate-400 hover:text-slate-200 bg-slate-800 p-1.5 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} onPaste={handleReceiptPaste} className="flex flex-col min-h-0 flex-1 overflow-hidden text-xs">
              <div className="space-y-4 overflow-y-auto px-5 py-4 flex-1 min-h-0">
              {formError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl font-medium">
                  {formError}
                </div>
              )}

              {/* Type toggle: Income vs Expense */}
              <div className="grid grid-cols-2 gap-2.5 bg-slate-950 p-1 rounded-xl border border-slate-800/80 font-bold text-center">
                <button 
                  type="button"
                  onClick={() => { setFormType(TransactionType.EXPENSE); setFormCategory(ExpenseCategory.FOOD); }}
                  className={`py-2 rounded-lg cursor-pointer transition-all ${formType === TransactionType.EXPENSE ? "bg-rose-500 text-slate-950" : "text-slate-400"}`}
                >
                  {t("finance.formExpenseBtn")}
                </button>
                <button
                  type="button"
                  onClick={() => { setFormType(TransactionType.INCOME); setFormCategory("Lương tháng"); }}
                  className={`py-2 rounded-lg cursor-pointer transition-all ${formType === TransactionType.INCOME ? "bg-emerald-500 text-slate-950" : "text-slate-400"}`}
                >
                  {t("finance.formIncomeBtn")}
                </button>
              </div>

              {/* Description Input */}
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">{t("finance.formDescLabel")} <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  placeholder={formType === TransactionType.EXPENSE ? t("finance.formDescPlaceholderExpense") : t("finance.formDescPlaceholderIncome")}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full bg-slate-950 neu-pressed-sm rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Amount — hàng riêng cho thoáng (kèm nút cộng dồn khi chi tiêu) */}
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">
                  {t("finance.formAmountLabel")} <span className="text-rose-400">*</span>
                  {formType === TransactionType.EXPENSE && (
                    <span className="ml-1 text-[10px] font-normal text-slate-500">{t("finance.formAmountHint")}</span>
                  )}
                </label>
                <MoneyInput
                  value={formAmount}
                  onChange={setFormAmount}
                  placeholder={t("finance.formAmountPlaceholder")}
                  operators={formType === TransactionType.EXPENSE}
                  className="w-full min-w-0 bg-slate-950 neu-pressed-sm rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-sky-500 font-bold"
                />
              </div>

              {/* Date — hàng riêng */}
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">{t("finance.formDateLabel")}</label>
                <DateInputDMY
                  value={formDate}
                  onChange={setFormDate}
                  className="w-full min-w-0 bg-slate-950 neu-pressed-sm rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              {/* Categorization and Wallet */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 block font-semibold">{formType === TransactionType.EXPENSE ? t("finance.formCatExpenseLabel") : t("finance.formCatIncomeLabel")}</label>
                  {formType === TransactionType.EXPENSE ? (
                    <FancySelect
                      value={formCategory as string}
                      onChange={setFormCategory}
                      ariaLabel={t("finance.formCatExpenseAriaLabel")}
                      options={expenseCategoryOptions}
                    />
                  ) : (
                    <div className="space-y-2">
                      <FancySelect
                        value={isPresetIncome(formCategory as string) ? (formCategory as string) : INCOME_CUSTOM}
                        onChange={(v) => setFormCategory(v === INCOME_CUSTOM ? "" : v)}
                        ariaLabel={t("finance.formCatIncomeAriaLabel")}
                        options={[
                          ...INCOME_CATEGORIES.map(c => ({ value: c, label: c })),
                          { value: INCOME_CUSTOM, label: t("finance.formCatOther") }
                        ]}
                      />
                      {!isPresetIncome(formCategory as string) && (
                        <input
                          type="text"
                          placeholder={t("finance.formCatOtherPlaceholder")}
                          value={formCategory}
                          onChange={(e) => setFormCategory(e.target.value)}
                          className="w-full bg-slate-950 neu-pressed-sm rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-sky-500"
                          autoFocus
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">{t("finance.formAccountLabel")}</label>
                  <FancySelect
                    value={formAccount}
                    onChange={(v) => setFormAccount(v as AccountType)}
                    ariaLabel={t("finance.formAccountAriaLabel")}
                    options={[
                      { value: "bank",     label: t("finance.formAccountBank") },
                      { value: "cash",     label: t("finance.formAccountCash") },
                      { value: "e_wallet", label: t("finance.formAccountEWallet") }
                    ]}
                  />
                </div>
              </div>

              {/* Receipt File upload */}
              <div className="space-y-1 bg-slate-950/40 p-4 neu-pressed-sm rounded-xl">
                <label className="text-slate-400 block font-semibold mb-1">{t("finance.formReceiptLabel")}</label>
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleFileChange}
                  disabled={receiptProcessing}
                  className="w-full text-slate-400 font-mono text-[10px] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-semibold file:bg-slate-800 file:text-sky-400 file:cursor-pointer hover:file:bg-slate-755 disabled:opacity-50"
                />
                {receiptProcessing && <p className="text-[10px] text-sky-400 mt-1">{t("finance.formReceiptUploading")}</p>}
                
                {formReceiptBase64 && (
                  <div className="mt-3 flex items-center justify-between bg-slate-900 p-2 border border-slate-800 rounded-lg">
                    <span className="text-emerald-400 text-[10px] flex items-center gap-1">{t("finance.formReceiptDone")}</span>
                    <button 
                      type="button" 
                      onClick={() => setFormReceiptBase64("")}
                      className="text-slate-500 hover:text-rose-400 stroke-2"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              </div>

              <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200 rounded-xl transition-all cursor-pointer font-bold"
                >
                  {t("finance.formClose")}
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${formType === TransactionType.EXPENSE ? "bg-rose-500 hover:bg-rose-450 text-slate-950" : "bg-emerald-500 hover:bg-emerald-450 text-slate-950"}`}
                >
                  {editingTx ? t("finance.formSaveEdit") : t("finance.formSave")}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Image Previewer Modal */}
      {selectedReceipt && (
        <div 
          onClick={() => setSelectedReceipt(null)}
          className="fixed inset-0 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center z-50 p-4 cursor-pointer"
          id="receipt-preview-modal"
        >
          <div ref={receiptRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("finance.receiptDialogAriaLabel")} className="relative max-w-full max-h-[85vh] p-1.5 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl outline-none">
            <img
              src={selectedReceipt}
              alt={t("finance.receiptAlt")} 
              className="max-w-full max-h-[80vh] object-contain rounded-xl"
              referrerPolicy="no-referrer"
            />
            <button 
              onClick={() => setSelectedReceipt(null)}
              className="absolute top-4 right-4 bg-slate-950/80 hover:bg-slate-800 p-2 text-slate-250 neu-btn hover:text-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      </>
      )}

      {/* Edit recurring bill modal */}
      {editingBill && (
        <div onClick={() => setEditingBill(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div ref={billEditorRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl outline-none">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-100">{t("finance.editBillDialogTitle")}</h3>
              <button onClick={() => setEditingBill(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEditBill} className="space-y-3 text-xs">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder={t("finance.editBillNamePlaceholder")}
                className="w-full bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none"
              />
              <input
                type="text"
                inputMode="numeric"
                value={formatMoneyInput(editAmount)}
                onChange={e => setEditAmount(parseMoneyInput(e.target.value))}
                placeholder={t("finance.editBillAmountPlaceholder")}
                className="w-full bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none"
              />
              <DateInputDMY
                value={editDueDate}
                onChange={setEditDueDate}
                className="w-full bg-slate-950 neu-pressed-sm rounded-xl px-3 py-2 text-slate-200 outline-none"
              />
              <FancySelect
                value={editFrequency}
                onChange={(v) => setEditFrequency(v as RecurringBill["frequency"])}
                ariaLabel={t("finance.editBillFreqAriaLabel")}
                options={billFrequencyOptions}
              />
              <FancySelect
                value={editCategory}
                onChange={setEditCategory}
                ariaLabel={t("finance.editBillCatAriaLabel")}
                options={billCategoryOptions}
              />
              {editError && <p className="text-[11px] text-rose-400">{editError}</p>}
              <p className="text-[10px] text-slate-500">{t("finance.editBillHint")}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingBill(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl px-3 py-2 font-bold cursor-pointer"
                >
                  {t("finance.editBillCancel")}
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl px-3 py-2 font-bold cursor-pointer"
                >
                  {t("finance.editBillSave")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In-app confirmation dialog */}
      {ConfirmDialog}
    </div>
  );
}
