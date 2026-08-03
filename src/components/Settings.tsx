/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  Database,
  History,
  UserPlus,
  Trash2,
  RefreshCw,
  Download,
  CheckCircle,
  AlertTriangle,
  Lock,
  UserCircle,
  Cake,
  Phone,
  Image as ImageIcon,
  Save,
  X,
  KeyRound,
  Pencil,
  Tag,
  Rocket,
  Sparkles,
  MapPin,
  Archive,
  Upload,
  Send,
  Calendar,
  Copy,
  Languages,
  Eye,
  EyeOff,
  Plus,
  Check
} from "lucide-react";
import { User, UserRole, FamilyRelation, FAMILY_RELATION_LABELS, ROLE_LABELS, CustomExpenseCategory } from "../types.js";
import { BUILTIN_EXPENSE_CATEGORIES, EXPENSE_CAT_COLOR_KEYS, catColor, resolveCategory } from "../utils/expenseCategories.js";
import { useModalA11y } from "../hooks/useModalA11y.js";
import { FancySelect } from "./FancySelect.js";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n/index.js";

// Role <select> options shared by the create + edit forms
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: UserRole.ADMIN, label: "Quản lý (Admin) — toàn quyền" },
  { value: UserRole.MEMBER, label: "Thành viên — người lớn" },
  { value: UserRole.CHILD, label: "Con / Trẻ em" },
  { value: UserRole.GUEST, label: "Khách (chỉ xem)" }
];

// Family relationship options (display label only, no permission effect)
const RELATION_OPTIONS = (Object.keys(FAMILY_RELATION_LABELS) as FamilyRelation[]).map(value => ({
  value,
  label: FAMILY_RELATION_LABELS[value]
}));

const GENDER_OPTIONS = [
  { value: "", label: "Chưa chọn" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" }
];

const RELATION_SELECT_OPTIONS = [{ value: "", label: "— Không đặt —" }, ...RELATION_OPTIONS];

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("family_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
import { motion } from "motion/react";
import { useConfirm } from "./ConfirmDialog.js";
import { Avatar } from "./Avatar.js";
import { optimizeImageFile } from "../utils/image.js";
import { uploadDataUrl } from "../utils/uploadImage.js";
import { reloadOnce, scheduleReloadFallback } from "../utils/appReload.js";
import { PushNotificationsCard } from "./PushNotificationsCard.js";
import { ShimmerLine, Reveal } from "./Lively.js";
import { DateInputDMY, formatDateVN } from "./DateTimePicker24.js";
import { VN_LOCATIONS } from "../utils/vnLocations.js";

type SettingsTab = "profile" | "members" | "backups" | "logs";

interface SettingsProps {
  currentUser: User;
  users: User[];
  activityLogs: any[];
  backups: any[];
  onCreateUser: (user: any) => Promise<any>;
  onDeleteUser: (id: string) => Promise<any>;
  onUpdateProfile: (profile: any) => Promise<any>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<any>;
  onResetUserPassword: (userId: string, newPassword: string) => Promise<any>;
  onAdminUpdateUser: (userId: string, data: any) => Promise<any>;
  requestedTab?: SettingsTab;
  requestedTabSeq?: number;
  onCreateBackup: () => Promise<any>;
  onRestoreBackup: (id: string) => Promise<any>;
  onDeleteBackup: (id: string) => Promise<any>;
  weatherLoc: string;
  onChangeWeatherLoc: (code: string) => void;
  rewardsEnabled: boolean;
  onSetRewardsEnabled: (enabled: boolean) => Promise<void>;
  rewardApprovalThreshold: number;
  onSetRewardApprovalThreshold: (threshold: number) => Promise<void>;
  customCategories: CustomExpenseCategory[];
  hiddenBuiltinCategories: string[];
  onSaveCustomCategory: (payload: Partial<CustomExpenseCategory>) => Promise<any>;
  onDeleteCustomCategory: (id: string) => Promise<any>;
  onSetHiddenCategories: (hidden: string[]) => Promise<any>;
}

// Bộ biểu tượng gợi ý cho hạng mục CHI — bấm chọn nhanh (vẫn nhập tay được emoji khác).
// Sắp theo nhóm chi tiêu quen thuộc của gia đình: ăn uống, mua sắm, nhà cửa/hoá đơn,
// đi lại, sức khoẻ, học hành, con cái/thú cưng, giải trí, tiền bạc.
const QUICK_EMOJIS = [
  "🍲", "🍔", "☕", "🛒", "🛍️", "👕", "💄", "🏠",
  "⚡", "💧", "🌐", "📱", "📺", "🚗", "🛵", "⛽",
  "✈️", "💊", "🏥", "🦷", "📚", "🎓", "👶", "🧸",
  "🐶", "🎮", "🎬", "🎁", "💰", "🏦", "💳", "🌸",
];

// ─── Quản lý hạng mục CHI (chỉ Admin, trong tab Hệ thống) ──────────────────
// Giữ nguyên các hạng mục MẶC ĐỊNH (chỉ ẩn/hiện), cho phép thêm hạng mục RIÊNG
// gồm tên + emoji + màu. Dùng chung nguồn màu/nhãn với Tài chính & Tổng quan.
interface CategoryManagerProps {
  customCategories: CustomExpenseCategory[];
  hiddenBuiltinCategories: string[];
  onSaveCustomCategory: (payload: Partial<CustomExpenseCategory>) => Promise<any>;
  onDeleteCustomCategory: (id: string) => Promise<any>;
  onSetHiddenCategories: (hidden: string[]) => Promise<any>;
  confirm: (opts: { title: string; message: string; confirmLabel?: string; tone?: "danger" | "default" }) => Promise<boolean>;
}

function CategoryManagerCard({
  customCategories,
  hiddenBuiltinCategories,
  onSaveCustomCategory,
  onDeleteCustomCategory,
  onSetHiddenCategories,
  confirm
}: CategoryManagerProps) {
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState("orange");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const hidden = new Set(hiddenBuiltinCategories);

  const resetForm = () => { setLabel(""); setEmoji(""); setColor("orange"); setEditingId(null); setErr(""); };

  const startEdit = (c: CustomExpenseCategory) => {
    setEditingId(c.id); setLabel(c.label); setEmoji(c.emoji || ""); setColor(c.color || "orange"); setErr("");
  };

  const toggleBuiltin = async (value: string) => {
    const next = hidden.has(value)
      ? hiddenBuiltinCategories.filter(v => v !== value)
      : [...hiddenBuiltinCategories, value];
    setBusy(true); setErr("");
    try { await onSetHiddenCategories(next); }
    catch (e: any) { setErr(e?.message || "Không lưu được"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!label.trim()) { setErr("Nhập tên hạng mục"); return; }
    setBusy(true); setErr("");
    try {
      await onSaveCustomCategory({ id: editingId || undefined, label: label.trim(), emoji: emoji.trim(), color });
      resetForm();
    } catch (e: any) { setErr(e?.message || "Không lưu được"); }
    finally { setBusy(false); }
  };

  const remove = async (c: CustomExpenseCategory) => {
    const ok = await confirm({
      title: `Xóa hạng mục "${c.label}"?`,
      message: "Hạng mục này sẽ bị xóa khỏi danh sách chọn. Các giao dịch cũ đã ghi vẫn được giữ lại nhưng sẽ hiển thị dạng nhãn xám.",
      confirmLabel: "Xóa hạng mục",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true); setErr("");
    try { await onDeleteCustomCategory(c.id); if (editingId === c.id) resetForm(); }
    catch (e: any) { setErr(e?.message || "Không xóa được"); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Tag className="w-4 h-4 text-amber-400" /> Hạng mục chi phí
        </h3>
        <p className="text-[11px] text-slate-500">
          Bấm để <b className="text-slate-300">ẩn/hiện</b> hạng mục mặc định không dùng, và
          <b className="text-slate-300"> thêm hạng mục riêng</b> của gia đình (tên + emoji + màu).
          Danh sách này áp dụng chung khi ghi thu chi.
        </p>
      </div>

      {/* Hạng mục MẶC ĐỊNH — chỉ ẩn/hiện, không xóa */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-bold text-slate-400">Mặc định của ứng dụng</p>
        <div className="flex flex-wrap gap-1.5">
          {BUILTIN_EXPENSE_CATEGORIES.map(b => {
            const isHidden = hidden.has(b.value);
            const meta = resolveCategory(b.value, customCategories);
            return (
              <button
                key={b.value}
                type="button"
                onClick={() => toggleBuiltin(b.value)}
                disabled={busy}
                title={isHidden ? "Đang ẩn — bấm để hiện lại" : "Đang hiện — bấm để ẩn"}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg neu-flat cursor-pointer transition-all disabled:opacity-50 ${
                  isHidden ? "bg-slate-900 text-slate-500" : `bg-slate-900 ${catColor(b.color).text}`
                }`}
              >
                <span className="leading-none">{b.emoji}</span>
                <span className={isHidden ? "line-through" : ""}>{meta.label}</span>
                {isHidden ? <EyeOff className="w-3 h-3 shrink-0" /> : <Eye className="w-3 h-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hạng mục RIÊNG của gia đình */}
      <div className="space-y-1.5 pt-1">
        <p className="text-[11px] font-bold text-slate-400">Của gia đình ({customCategories.length})</p>
        {customCategories.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">Chưa có hạng mục tự thêm nào.</p>
        ) : (
          <div className="space-y-1.5">
            {customCategories.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-slate-900 neu-flat rounded-lg px-2.5 py-1.5">
                <span className={`w-5 h-5 shrink-0 rounded-full grid place-items-center text-[11px] bg-gradient-to-br ${catColor(c.color).bar}`}>
                  {c.emoji || "🏷️"}
                </span>
                <span className="text-xs font-semibold text-slate-200 truncate flex-1">{c.label}</span>
                <button
                  type="button" onClick={() => startEdit(c)} disabled={busy}
                  title="Sửa" aria-label={`Sửa ${c.label}`}
                  className="p-1.5 bg-slate-950 neu-btn rounded-lg text-slate-500 hover:text-amber-400 cursor-pointer disabled:opacity-50"
                ><Pencil className="w-3.5 h-3.5" /></button>
                <button
                  type="button" onClick={() => remove(c)} disabled={busy}
                  title="Xóa" aria-label={`Xóa ${c.label}`}
                  className="p-1.5 bg-slate-950 neu-btn rounded-lg text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-50"
                ><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form thêm / sửa hạng mục riêng */}
      <div className="pt-2 mt-1 border-t border-slate-800/70 space-y-2">
        <p className="text-[11px] font-bold text-slate-400">{editingId ? "Sửa hạng mục" : "Thêm hạng mục mới"}</p>
        <div className="flex items-center gap-2">
          <input
            type="text" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4}
            placeholder="🏷️" aria-label="Emoji hạng mục"
            className="w-14 shrink-0 text-center bg-slate-950 neu-pressed-sm rounded-lg px-2 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
          />
          <input
            type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30}
            placeholder="Tên hạng mục (vd: Thú cưng)" aria-label="Tên hạng mục"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            className="flex-1 min-w-0 bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
          />
        </div>
        {/* Biểu tượng gợi ý — bấm để chọn nhanh */}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Biểu tượng</span>
          <div className="mt-1.5 max-w-[19rem] bg-slate-950/40 neu-pressed-sm rounded-xl p-2">
            <div className="grid grid-cols-8 gap-1">
              {QUICK_EMOJIS.map(e => {
                const active = emoji.trim() === e;
                return (
                  <button
                    key={e} type="button" onClick={() => setEmoji(e)}
                    aria-label={`Biểu tượng ${e}`} aria-pressed={active}
                    className={`w-8 h-8 grid place-items-center rounded-lg text-lg leading-none cursor-pointer transition-colors ${
                      active ? "bg-indigo-500/20 ring-1 ring-indigo-500/50" : "hover:bg-slate-800"
                    }`}
                  >{e}</button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Xem trước — hiện đúng như chip hạng mục trong danh sách thu chi */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">Xem trước</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold min-w-0 ${catColor(color).chip}`}>
            <span className="leading-none">{emoji.trim() || "🏷️"}</span>
            <span className="truncate">{label.trim() || "Tên hạng mục"}</span>
          </span>
        </div>

        {/* Bảng màu — khay lõm, lưới đều, ô đang chọn có dấu ✓ */}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Màu nhãn</span>
          <div className="mt-1.5 max-w-[19rem] bg-slate-950/40 neu-pressed-sm rounded-xl p-2.5">
            <div className="grid grid-cols-8 gap-2 place-items-center">
              {EXPENSE_CAT_COLOR_KEYS.map(k => {
                const active = color === k;
                return (
                  <button
                    key={k} type="button" onClick={() => setColor(k)}
                    aria-label={`Màu ${k}`} aria-pressed={active} title={k}
                    className={`relative w-7 h-7 rounded-full bg-gradient-to-br ${catColor(k).bar} cursor-pointer transition-transform duration-150 hover:scale-110 ${
                      active ? "ring-2 ring-slate-100 ring-offset-2 ring-offset-slate-950" : "hover:ring-1 hover:ring-slate-100/40"
                    }`}
                  >
                    {active && <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {err && <p className="text-[11px] text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={submit} disabled={busy || !label.trim()}
            className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl px-3.5 py-2 text-xs font-bold cursor-pointer transition-all disabled:opacity-50"
          >
            {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {busy ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Thêm hạng mục"}
          </button>
          {editingId && (
            <button
              type="button" onClick={resetForm} disabled={busy}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold cursor-pointer transition-all disabled:opacity-50"
            ><X className="w-4 h-4" /> Hủy</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Settings({
  currentUser,
  users,
  activityLogs,
  backups,
  onCreateUser,
  onDeleteUser,
  onUpdateProfile,
  onChangePassword,
  onResetUserPassword,
  onAdminUpdateUser,
  requestedTab = "profile",
  requestedTabSeq = 0,
  onCreateBackup,
  onRestoreBackup,
  onDeleteBackup,
  weatherLoc,
  onChangeWeatherLoc,
  rewardsEnabled,
  onSetRewardsEnabled,
  rewardApprovalThreshold,
  onSetRewardApprovalThreshold,
  customCategories,
  hiddenBuiltinCategories,
  onSaveCustomCategory,
  onDeleteCustomCategory,
  onSetHiddenCategories
}: SettingsProps) {
  const { t, i18n } = useTranslation();
  // In-app confirmation dialog (replaces native browser confirm)
  const { confirm, ConfirmDialog } = useConfirm();
  // Tab configuration
  const [activeTab, setActiveTab] = useState<SettingsTab>(requestedTab);

  // Activity log pagination
  const [logsLimit, setLogsLimit] = useState(30);

  // Registration form
  const [regUsername, setRegUsername] = useState("");
  const [regFullName, setRegFullName] = useState("");
  const [regRole, setRegRole] = useState<UserRole>(UserRole.MEMBER);
  const [regRelation, setRegRelation] = useState<FamilyRelation | "">("");
  const [regPassword, setRegPassword] = useState("");
  const [regAvatar, setRegAvatar] = useState("bg-indigo-500");
  const [regDob, setRegDob] = useState("");
  const [regGender, setRegGender] = useState<"male" | "female" | "">("");
  const [regPhone, setRegPhone] = useState("");

  // My-profile form (self-service personalization)
  const [profFullName, setProfFullName] = useState(currentUser.fullName);
  const [profDob, setProfDob] = useState(currentUser.dateOfBirth || "");
  const [profGender, setProfGender] = useState<"male" | "female" | "">(currentUser.gender || "");
  const [profPhone, setProfPhone] = useState(currentUser.phone || "");
  const [profAvatarImage, setProfAvatarImage] = useState(currentUser.avatarImage || "");
  const [profAvatarColor, setProfAvatarColor] = useState(currentUser.avatarColor || "bg-indigo-500");

  // Keep the profile form in sync when the active account changes (e.g. account switch)
  useEffect(() => {
    setProfFullName(currentUser.fullName);
    setProfDob(currentUser.dateOfBirth || "");
    setProfGender(currentUser.gender || "");
    setProfPhone(currentUser.phone || "");
    setProfAvatarImage(currentUser.avatarImage || "");
    setProfAvatarColor(currentUser.avatarColor || "bg-indigo-500");
  }, [currentUser.id]);

  // Change-password form (own account)
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  // Admin reset-password modal state
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetNewPwd, setResetNewPwd] = useState("");

  // Admin edit-user modal state
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [euFullName, setEuFullName] = useState("");
  const [euRole, setEuRole] = useState<UserRole>(UserRole.MEMBER);
  const [euRelation, setEuRelation] = useState<FamilyRelation | "">("");
  const [euDob, setEuDob] = useState("");
  const [euGender, setEuGender] = useState<"male" | "female" | "">("");
  const [euPhone, setEuPhone] = useState("");
  const [euColor, setEuColor] = useState("bg-indigo-500");

  // Action state trackers
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  // Version & self-update state
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [updateCheck, setUpdateCheck] = useState<any>(null);
  const [updateBusy, setUpdateBusy] = useState<"" | "check" | "apply" | "deploying">("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateDone, setUpdateDone] = useState(false);

  // Toggle tính năng Điểm thưởng cho trẻ — admin only
  const [rewardsBusy, setRewardsBusy] = useState(false);
  const [rewardsErr, setRewardsErr] = useState("");
  const toggleRewards = async () => {
    setRewardsBusy(true);
    setRewardsErr("");
    try {
      await onSetRewardsEnabled(!rewardsEnabled);
    } catch (e: any) {
      setRewardsErr(e?.message || "Không đổi được cài đặt.");
    } finally {
      setRewardsBusy(false);
    }
  };

  // Ngưỡng tự duyệt điểm thưởng — admin only
  const [thresholdInput, setThresholdInput] = useState<string>(String(rewardApprovalThreshold || 0));
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [thresholdMsg, setThresholdMsg] = useState("");
  useEffect(() => { setThresholdInput(String(rewardApprovalThreshold || 0)); }, [rewardApprovalThreshold]);
  const saveThreshold = async () => {
    setThresholdBusy(true);
    setThresholdMsg("");
    try {
      await onSetRewardApprovalThreshold(Math.max(0, Math.floor(Number(thresholdInput) || 0)));
      setThresholdMsg("Đã lưu ✓");
    } catch (e: any) {
      setThresholdMsg(e?.message || "Không đổi được cài đặt.");
    } finally {
      setThresholdBusy(false);
    }
  };

  // AI (Gemini) key config — admin only
  const [aiKeyStatus, setAiKeyStatus] = useState<{ configured: boolean; source: string; masked: string } | null>(null);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiKeyBusy, setAiKeyBusy] = useState(false);
  const [aiKeyMsg, setAiKeyMsg] = useState("");
  const [aiKeyErr, setAiKeyErr] = useState("");

  // ICS subscribe feed — mọi thành viên đăng ký lịch gia đình vào Apple/Google Calendar
  const [icsToken, setIcsToken] = useState("");
  const [icsCopied, setIcsCopied] = useState(false);

  // Backup tự động qua Telegram bot — admin only
  interface TgBackupStatus { configured: boolean; enabled: boolean; weeklyDigestEnabled: boolean; maskedToken: string; chatId: string; lastSent: string }
  const [tgStatus, setTgStatus] = useState<TgBackupStatus | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgBusy, setTgBusy] = useState<"" | "save" | "test">("");
  const [tgMsg, setTgMsg] = useState("");
  const [tgErr, setTgErr] = useState("");
  const [tgDigestBusy, setTgDigestBusy] = useState(false);
  const [tgDigestMsg, setTgDigestMsg] = useState("");

  // Escape-to-close + scroll lock + focus trap for the edit-user & reset-password modals
  const editTargetRef = useRef<HTMLDivElement | null>(null);
  const resetTargetRef = useRef<HTMLDivElement | null>(null);
  const closeEditTarget = useCallback(() => setEditTarget(null), []);
  const closeResetTarget = useCallback(() => setResetTarget(null), []);
  useModalA11y(!!editTarget, closeEditTarget, editTargetRef);
  useModalA11y(!!resetTarget, closeResetTarget, resetTargetRef);

  useEffect(() => {
    fetch("/api/version", { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setVersionInfo(d); })
      .catch(() => {});
    fetch("/api/calendar/feed-info", { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.token) setIcsToken(d.token); })
      .catch(() => {});
  }, []);

  // URL đăng ký lịch: webcal:// để Apple Calendar nhận diện "Subscribe" ngay
  const icsUrl = icsToken
    ? `webcal://${window.location.host}/api/calendar.ics?token=${icsToken}`
    : "";

  const copyIcsUrl = async () => {
    if (!icsUrl) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(icsUrl);
      else {
        const ta = document.createElement("textarea");
        ta.value = icsUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setIcsCopied(true);
      window.setTimeout(() => setIcsCopied(false), 2000);
    } catch { /* copy thất bại — người dùng bôi đen tay */ }
  };

  useEffect(() => {
    if (currentUser.role !== UserRole.ADMIN) return;
    fetch("/api/settings/ai", { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setAiKeyStatus(d); })
      .catch(() => {});
    fetch("/api/settings/telegram-backup", { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setTgStatus(d); setTgChatId(d.chatId || ""); } })
      .catch(() => {});
  }, []);

  // Lưu cấu hình Telegram (token/chat id chỉ gửi khi người dùng có nhập) hoặc bật/tắt
  const saveTgConfig = async (patch: { botToken?: string; chatId?: string; enabled?: boolean; weeklyDigestEnabled?: boolean }) => {
    setTgBusy("save"); setTgMsg(""); setTgErr("");
    try {
      const res = await fetch("/api/settings/telegram-backup", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu cấu hình thất bại.");
      setTgStatus(data);
      setTgToken("");
      setTgMsg("Đã lưu cấu hình Telegram.");
    } catch (err: any) {
      setTgErr(err.message || "Lưu cấu hình thất bại.");
    } finally {
      setTgBusy("");
    }
  };

  const sendTgTest = async () => {
    setTgBusy("test"); setTgMsg(""); setTgErr("");
    try {
      const res = await fetch("/api/settings/telegram-backup/test", { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gửi thử thất bại.");
      setTgStatus(data);
      setTgMsg(data.message || "Đã gửi backup qua Telegram.");
    } catch (err: any) {
      setTgErr(err.message || "Gửi thử thất bại.");
    } finally {
      setTgBusy("");
    }
  };

  const sendTgDigestTest = async () => {
    setTgDigestBusy(true); setTgDigestMsg(""); setTgMsg(""); setTgErr("");
    try {
      const res = await fetch("/api/settings/telegram-digest/test", { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gửi thử thất bại.");
      setTgDigestMsg(data.message || "Đã gửi bản tin tuần qua Telegram.");
    } catch (err: any) {
      setTgDigestMsg("Lỗi: " + (err.message || "Gửi thử thất bại."));
    } finally {
      setTgDigestBusy(false);
    }
  };

  const saveAiKey = async (clear = false) => {
    setAiKeyBusy(true);
    setAiKeyMsg("");
    setAiKeyErr("");
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: clear ? "" : aiKeyInput.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu key thất bại.");
      setAiKeyStatus({ configured: data.configured, source: data.source, masked: data.masked });
      setAiKeyMsg(data.message || "Đã cập nhật.");
      setAiKeyInput("");
    } catch (err: any) {
      setAiKeyErr(err.message || "Lưu key thất bại.");
    } finally {
      setAiKeyBusy(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateBusy("check");
    setUpdateMsg("");
    try {
      const res = await fetch("/api/version/check", { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không kiểm tra được cập nhật.");
      setUpdateCheck(data);
    } catch (err: any) {
      setUpdateCheck(null);
      setUpdateMsg(err.message || "Không kiểm tra được cập nhật.");
    } finally {
      setUpdateBusy("");
    }
  };

  // Poll /api/version until the server reports a different commit (= new image is
  // live). Tolerates the brief downtime while the container pulls & restarts.
  const waitForNewVersion = async (fromCommit: string): Promise<boolean> => {
    const startedAt = Date.now();
    const TIMEOUT_MS = 4 * 60 * 1000; // give the Pi up to 4 minutes to pull + boot
    const POLL_MS = 3000;
    while (Date.now() - startedAt < TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_MS));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setUpdateMsg(`Đang tải bản mới & khởi động lại máy chủ… (${elapsed}s)`);
      try {
        const res = await fetch("/api/version", { headers: authHeaders(), cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          if (d?.commit && fromCommit && d.commit !== fromCommit) {
            setVersionInfo(d);
            return true;
          }
        }
      } catch {
        // server is restarting — keep waiting
      }
    }
    return false;
  };

  // Pull the freshest service worker + assets, then reload into the new build.
  // Bản mới đã được xác nhận đang chạy trên máy chủ trước khi gọi hàm này.
  const reloadIntoNewVersion = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          // Nếu có SW mới đang chờ: kích hoạt nó (controllerchange sẽ reload),
          // kèm dự phòng. Nếu không có: reload thẳng (network-first lấy bản mới).
          if (reg.waiting) {
            reg.waiting.postMessage("SKIP_WAITING");
            scheduleReloadFallback(3000);
            return;
          }
        }
      }
    } catch {
      /* ignore — reload still fetches fresh index.html (network-first) */
    }
    reloadOnce();
  };

  const handleApplyUpdate = async () => {
    const fromCommit: string = versionInfo?.commit || "";
    setUpdateDone(false);
    setUpdateBusy("apply");
    setUpdateMsg("Đang gửi yêu cầu cập nhật…");
    try {
      // Kích hoạt update. Watchtower thường tải image mới & RESTART container app
      // ngay trong lúc xử lý yêu cầu này → kết nối bị cắt và fetch ném
      // TypeError("Failed to fetch") DÙ update đã chạy thành công. Vì vậy chỉ coi
      // là lỗi thật khi server phản hồi rõ ràng (vd Watchtower chưa cấu hình);
      // lỗi mạng thì xem như đã kích hoạt và chuyển sang chờ bản mới lên.
      try {
        const res = await fetch("/api/update", { method: "POST", headers: authHeaders() });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Cập nhật thất bại.");
        }
      } catch (err: any) {
        // TypeError = lỗi mạng (kết nối bị cắt do container đang restart) → tiếp tục chờ.
        // Lỗi khác (từ nhánh !res.ok ở trên) = lỗi thật → báo ra ngoài.
        if (!(err instanceof TypeError)) throw err;
      }

      setUpdateBusy("deploying");
      setUpdateMsg("Đã yêu cầu cập nhật. Đang chờ máy chủ tải bản mới…");

      const ok = await waitForNewVersion(fromCommit);
      if (ok) {
        setUpdateDone(true);
        setUpdateMsg("Cập nhật xong! Đang tải lại ứng dụng…");
        await reloadIntoNewVersion();
      } else {
        setUpdateBusy("");
        setUpdateMsg("Đã kích hoạt cập nhật nhưng chờ hơi lâu. Hãy thử tải lại trang sau ít phút.");
      }
    } catch (err: any) {
      setUpdateBusy("");
      setUpdateMsg(err.message || "Cập nhật thất bại.");
    }
  };

  useEffect(() => {
    setActiveTab(requestedTab);
    setActionSuccess("");
    setActionError("");
  }, [requestedTab, requestedTabSeq]);

  const handleRegisterUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (!regUsername.trim() || !regFullName.trim() || !regPassword) {
      setActionError("Vui lòng điền đầy đủ các trường thông tin bắt buộc!");
      return;
    }

    setLoadingAction("register");
    try {
      await onCreateUser({
        username: regUsername.toLowerCase().trim(),
        fullName: regFullName.trim(),
        role: regRole,
        familyRelation: regRelation || undefined,
        passwordPlain: regPassword,
        avatarColor: regAvatar,
        dateOfBirth: regDob || undefined,
        gender: regGender || undefined,
        phone: regPhone.trim() || undefined
      });
      setActionSuccess(`Đã tạo tài khoản thành viên mới cho ${regFullName.trim()} thành công!`);
      // Reset
      setRegUsername("");
      setRegFullName("");
      setRegPassword("");
      setRegDob("");
      setRegGender("");
      setRegPhone("");
      setRegRelation("");
    } catch (err: any) {
      setActionError(err.message || "Tạo tài khoản thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setActionError("");
    setActionSuccess("");
    setAvatarProcessing(true);
    try {
      const optimized = await optimizeImageFile(file, {
        maxSourceBytes: 20 * 1024 * 1024,
        targetBytes: 850 * 1024,
        maxSizes: [512, 384, 256],
        qualities: [0.86, 0.76, 0.66, 0.56],
        backgroundColor: "#ffffff"
      });
      const url = await uploadDataUrl(optimized.dataUrl, "avatars");
      setProfAvatarImage(url);
      setActionSuccess(`Đã tải ảnh đại diện (~${optimized.sizeKb}KB, ${optimized.width}x${optimized.height}). Bấm "Lưu hồ sơ cá nhân" để áp dụng.`);
    } catch (err: any) {
      setActionError(err.message || "Không xử lý được tệp ảnh này.");
    } finally {
      setAvatarProcessing(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");
    if (!profFullName.trim()) {
      setActionError("Tên hiển thị không được để trống!");
      return;
    }
    setLoadingAction("profile");
    try {
      await onUpdateProfile({
        fullName: profFullName.trim(),
        dateOfBirth: profDob,
        gender: profGender,
        phone: profPhone,
        avatarImage: profAvatarImage,
        avatarColor: profAvatarColor
      });
      setActionSuccess("Đã cập nhật hồ sơ cá nhân của bạn thành công!");
    } catch (err: any) {
      setActionError(err.message || "Cập nhật hồ sơ thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");
    if (!curPwd || !newPwd) {
      setActionError("Vui lòng nhập mật khẩu hiện tại và mật khẩu mới!");
      return;
    }
    if (newPwd.length < 4) {
      setActionError("Mật khẩu mới phải có ít nhất 4 ký tự!");
      return;
    }
    if (newPwd !== confirmPwd) {
      setActionError("Xác nhận mật khẩu mới không khớp!");
      return;
    }
    setLoadingAction("password");
    try {
      await onChangePassword({ currentPassword: curPwd, newPassword: newPwd });
      setActionSuccess("Đã đổi mật khẩu thành công!");
      setCurPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (err: any) {
      setActionError(err.message || "Đổi mật khẩu thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setActionError("");
    setActionSuccess("");
    if (resetNewPwd.length < 4) {
      setActionError("Mật khẩu mới phải có ít nhất 4 ký tự!");
      return;
    }
    setLoadingAction("reset-pwd");
    try {
      await onResetUserPassword(resetTarget.id, resetNewPwd);
      setActionSuccess(`Đã đặt lại mật khẩu cho ${resetTarget.fullName}.`);
      setResetTarget(null);
      setResetNewPwd("");
    } catch (err: any) {
      setActionError(err.message || "Đặt lại mật khẩu thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleOpenEditUser = (u: User) => {
    setEditTarget(u);
    setEuFullName(u.fullName);
    setEuRole(u.role);
    setEuRelation(u.familyRelation || "");
    setEuDob(u.dateOfBirth || "");
    setEuGender(u.gender || "");
    setEuPhone(u.phone || "");
    setEuColor(u.avatarColor || "bg-indigo-500");
    setActionError("");
    setActionSuccess("");
  };

  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setActionError("");
    setActionSuccess("");
    if (!euFullName.trim()) {
      setActionError("Tên hiển thị không được để trống!");
      return;
    }
    setLoadingAction("edit-user");
    try {
      await onAdminUpdateUser(editTarget.id, {
        fullName: euFullName.trim(),
        role: euRole,
        familyRelation: euRelation || undefined,
        dateOfBirth: euDob,
        gender: euGender,
        phone: euPhone,
        avatarColor: euColor
      });
      setActionSuccess(`Đã cập nhật thông tin của ${euFullName.trim()}.`);
      setEditTarget(null);
    } catch (err: any) {
      setActionError(err.message || "Cập nhật thành viên thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleTriggerManualBackup = async () => {
    setActionError("");
    setActionSuccess("");
    setLoadingAction("backup");
    try {
      const res = await onCreateBackup();
      setActionSuccess(`Tạo backup thủ công thành công! Tên tệp: ${res.filename} (${res.sizeKb} KB)`);
    } catch (err: any) {
      setActionError(err.message || "Sao lưu thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  // ─── Sao lưu TOÀN PHẦN: 1 tệp .zip = DB + toàn bộ ảnh/tệp + cấu hình ──────
  const fullImportInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownloadFullBackup = async () => {
    setActionError("");
    setActionSuccess("");
    setLoadingAction("full-export");
    try {
      const res = await fetch("/api/admin/backups/full/export", { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Không tải được tệp sao lưu toàn phần");
      }
      // Server cũ chưa có API này sẽ trả về trang HTML (SPA fallback) thay vì zip —
      // chặn lại để không lưu nhầm tệp rác.
      const contentType = res.headers.get("Content-Type") || "";
      if (!contentType.includes("application/zip")) {
        throw new Error("Server chưa chạy phiên bản có API sao lưu toàn phần — hãy khởi động lại / cập nhật server rồi thử lại.");
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "family-organizer_full.zip";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setActionSuccess(`Đã tải về ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB). Hãy cất tệp ở nơi an toàn NGOÀI server (máy tính, ổ cứng rời, cloud riêng).`);
    } catch (err: any) {
      setActionError(err.message || "Xuất backup toàn phần thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFullImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setActionError("");
    setActionSuccess("");
    const ok = await confirm({
      title: "Khôi phục TOÀN PHẦN hệ thống?",
      message: `CẢNH BÁO: Toàn bộ dữ liệu + ảnh/tệp hiện tại sẽ bị THAY THẾ HOÀN TOÀN bằng nội dung trong "${file.name}". Hệ thống sẽ tự tạo một backup an toàn của trạng thái hiện tại trước khi ghi đè. Bạn có chắc chắn tiếp tục?`,
      confirmLabel: "Khôi phục toàn phần",
      tone: "danger"
    });
    if (!ok) return;
    setLoadingAction("full-import");
    try {
      const res = await fetch("/api/admin/backups/full/import", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/zip" },
        body: file
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(
          data?.error ||
          "Khôi phục thất bại — nếu vừa cập nhật app, hãy khởi động lại server để nạp API mới rồi thử lại."
        );
      }
      setActionSuccess(`Khôi phục toàn phần thành công (${data?.restoredFiles ?? 0} tệp media). Ứng dụng sẽ tự tải lại...`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setActionError(err.message || "Khôi phục toàn phần thất bại");
      setLoadingAction(null);
    }
  };

  const handleDeleteUserClick = async (member: User) => {
    setActionError("");
    setActionSuccess("");
    const ok = await confirm({
      title: `Xóa thành viên ${member.fullName}?`,
      message: `Tài khoản @${member.username} sẽ bị xóa vĩnh viễn và không thể đăng nhập nữa. Các bản ghi (công việc, ghi chú, giao dịch) do thành viên này tạo trước đó vẫn được giữ lại trong hệ thống.`,
      confirmLabel: "Xóa thành viên",
      tone: "danger"
    });
    if (!ok) return;

    setLoadingAction(`delete-user-${member.id}`);
    try {
      await onDeleteUser(member.id);
      setActionSuccess(`Đã xóa tài khoản ${member.fullName} khỏi gia đình.`);
    } catch (err: any) {
      setActionError(err.message || "Xóa thành viên thất bại");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRestoreClick = async (backupId: string, filename: string) => {
    setActionError("");
    setActionSuccess("");
    const ok = await confirm({
      title: "Khôi phục cơ sở dữ liệu?",
      message: `CẢNH BÁO: Toàn bộ dữ liệu hiện tại sẽ bị THAY THẾ bằng dữ liệu tại điểm sao lưu "${filename}". Mọi thay đổi phát sinh sau thời điểm đó sẽ mất. Bạn có chắc chắn không?`,
      confirmLabel: "Khôi phục ngay",
      tone: "danger"
    });
    if (ok) {
      setLoadingAction(`restore-${backupId}`);
      try {
        await onRestoreBackup(backupId);
        setActionSuccess("Khôi phục cấu trúc dữ liệu thành công! Ứng dụng đã được đồng bộ hóa về điểm backup.");
        // Short page refresh to ensure client state refetches cleanly
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } catch (err: any) {
        setActionError(err.message || "Phục hồi tệp thất bại");
      } finally {
        setLoadingAction(null);
      }
    }
  };

  const handleDeleteBackupClick = async (backupId: string) => {
    const ok = await confirm({
      title: "Xóa tệp sao lưu?",
      message: "Tệp backup vật lý này sẽ bị xóa khỏi đĩa và không thể khôi phục lại. Bạn có chắc chắn không?",
      confirmLabel: "Xóa tệp",
      tone: "danger"
    });
    if (ok) {
      await onDeleteBackup(backupId);
    }
  };

  // Avatar colors presets
  const colors = [
    "bg-indigo-500", "bg-sky-500", "bg-emerald-500", "bg-teal-500", 
    "bg-rose-500", "bg-pink-500", "bg-amber-500", "bg-purple-500"
  ];

  return (
    <Reveal className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-6" id="settings-module">
      <ShimmerLine accent="indigo" />

      {/* Settings Navigation sub-header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4" id="settings-sub-header">
        
        {/* Navigation Tabs */}
        <div className="flex flex-wrap bg-slate-950 p-1.5 rounded-xl neu-pressed-sm gap-1 text-xs">
          <button
            onClick={() => { setActiveTab("profile"); setActionSuccess(""); setActionError(""); }}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${activeTab === "profile" ? "bg-slate-900 neu-flat text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            <UserCircle className="w-4 h-4 text-indigo-400" /> {t("settings.tabs.profile")}
          </button>
          <button
            onClick={() => { setActiveTab("members"); setActionSuccess(""); setActionError(""); }}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${activeTab === "members" ? "bg-slate-900 neu-flat text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Users className="w-4 h-4 text-sky-400" /> {t("settings.tabs.members")}
          </button>
          <button
            onClick={() => { setActiveTab("backups"); setActionSuccess(""); setActionError(""); }}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${activeTab === "backups" ? "bg-slate-900 neu-flat text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Database className="w-4 h-4 text-amber-400" /> {t("settings.tabs.system")}
          </button>
          <button
            onClick={() => { setActiveTab("logs"); setActionSuccess(""); setActionError(""); }}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${activeTab === "logs" ? "bg-slate-900 neu-flat text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            <History className="w-4 h-4 text-emerald-400" /> {t("settings.tabs.logs")}
          </button>
        </div>

        {/* Current status info tag */}
        <span className="text-[10px] uppercase font-mono bg-slate-950 text-slate-400 border border-slate-850 px-2.5 py-1 rounded-lg">
          Quyền hạn: <span className="text-sky-400 font-bold">{ROLE_LABELS[currentUser.role]}</span>
        </span>
      </div>

      {/* General feedback boxes inside settings */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Render sub-tab content */}
      {activeTab === "profile" && (
        <div className="space-y-6" id="settings-tab-profile">
          <PushNotificationsCard />
          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Avatar personalization */}
            <div className="bg-slate-950 p-4.5 rounded-2xl neu-pressed-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <ImageIcon className="w-4.5 h-4.5 text-indigo-400" /> Ảnh đại diện
              </h3>

              <div className="flex items-center gap-4">
                <Avatar
                  user={{ fullName: profFullName || currentUser.fullName, avatarColor: profAvatarColor, avatarImage: profAvatarImage || undefined }}
                  className="w-20 h-20 rounded-2xl text-3xl"
                  extraClass="shrink-0 border border-slate-800"
                />
                <div className="space-y-2 text-xs">
                  <label className={`inline-block bg-slate-800 hover:bg-slate-700 text-sky-400 font-semibold px-3 py-1.5 rounded-lg transition-all ${avatarProcessing ? "opacity-60 cursor-wait pointer-events-none" : "cursor-pointer"}`}>
                    {avatarProcessing ? "Đang tối ưu ảnh..." : "Tải ảnh lên"}
                    <input type="file" accept="image/*,.heic,.heif" onChange={handleAvatarFile} disabled={avatarProcessing} className="hidden" />
                  </label>
                  {profAvatarImage && (
                    <button
                      type="button"
                      disabled={avatarProcessing}
                      onClick={() => setProfAvatarImage("")}
                      className="flex items-center gap-1 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X className="w-3.5 h-3.5" /> Xóa ảnh, dùng màu nền
                    </button>
                  )}
                  <p className="text-[10px] text-slate-500 leading-relaxed">Ảnh lớn sẽ được tự thu nhỏ và nén trước khi lưu. Nếu không có ảnh, hệ thống dùng chữ cái trên nền màu bên dưới.</p>
                </div>
              </div>

              {/* Fallback color */}
              <div className="space-y-1.5">
                <label className="text-slate-400 block font-semibold text-xs">Màu nền dự phòng</label>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {colors.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setProfAvatarColor(c)}
                      className={`w-5.5 h-5.5 rounded-full cursor-pointer border-2 transition-all shrink-0 ${profAvatarColor === c ? "border-slate-100 scale-110" : "border-transparent opacity-80"}`}
                      title={c}
                      style={{ backgroundColor: c === "bg-indigo-500" ? "#6366f1" : c === "bg-sky-500" ? "#0ea5e9" : c === "bg-emerald-500" ? "#10b981" : c === "bg-teal-500" ? "#14b8a6" : c === "bg-rose-500" ? "#f43f5e" : c === "bg-pink-500" ? "#ec4899" : c === "bg-amber-500" ? "#f59e0b" : "#a855f7" }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Personal info fields */}
            <div className="bg-slate-950 p-4.5 rounded-2xl neu-pressed-sm space-y-3.5">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <UserCircle className="w-4.5 h-4.5 text-sky-400" /> Thông tin cá nhân
              </h3>

              <div className="space-y-1 text-xs">
                <label className="text-slate-400 block font-semibold">Tên đăng nhập (không đổi được)</label>
                <input
                  type="text"
                  value={`@${currentUser.username}`}
                  disabled
                  className="w-full bg-slate-900/50 neu-pressed-sm rounded-lg p-2 text-slate-500 font-mono cursor-not-allowed"
                />
              </div>

              <div className="space-y-1 text-xs">
                <label className="text-slate-400 block font-semibold">Tên xưng hô hiển thị <span className="text-rose-450">*</span></label>
                <input
                  type="text"
                  value={profFullName}
                  onChange={(e) => setProfFullName(e.target.value)}
                  placeholder="Ví dụ: Bố Hùng"
                  className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 text-xs min-w-0">
                  <label className="text-slate-400 font-semibold flex items-center gap-1"><Cake className="w-3.5 h-3.5 text-pink-400" /> Ngày sinh</label>
                  <DateInputDMY
                    value={profDob}
                    onChange={setProfDob}
                    className="w-full min-w-0 bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div className="space-y-1 text-xs min-w-0">
                  <label className="text-slate-400 font-semibold flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-emerald-400" /> Số điện thoại</label>
                  <input
                    type="tel"
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    placeholder="09xx xxx xxx"
                    className="w-full min-w-0 bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div className="space-y-1 text-xs min-w-0">
                  <label className="text-slate-400 font-semibold">Giới tính <span className="text-slate-600 font-normal">(để tính BMI)</span></label>
                  <FancySelect
                    value={profGender}
                    onChange={(v) => setProfGender(v as "male" | "female" | "")}
                    ariaLabel="Giới tính"
                    placeholder="Chưa chọn"
                    className="bg-slate-900"
                    options={GENDER_OPTIONS}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loadingAction === "profile" || avatarProcessing}
                className="w-full mt-2 bg-indigo-500 hover:bg-indigo-400 text-slate-950 font-bold py-2 px-4 rounded-xl cursor-pointer transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                {loadingAction === "profile" ? "Đang lưu..." : avatarProcessing ? "Đang tối ưu ảnh..." : "Lưu hồ sơ cá nhân"}
              </button>
            </div>
          </form>

          {/* Địa phương thời tiết (lưu riêng từng người trên máy này) */}
          <div className="bg-slate-950 p-4.5 rounded-2xl neu-pressed-sm space-y-3 max-w-md">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <MapPin className="w-4.5 h-4.5 text-sky-400" /> Địa phương xem thời tiết
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Chọn tỉnh/thành của bạn để trang Tổng quan hiển thị thời tiết và cảnh báo động đất theo khu vực. Cài đặt này riêng cho từng người và lưu trên thiết bị này.
            </p>
            <div className="text-xs">
              <FancySelect
                value={weatherLoc}
                onChange={onChangeWeatherLoc}
                ariaLabel="Chọn địa phương xem thời tiết"
                className="bg-slate-900"
                options={VN_LOCATIONS.map(l => ({ value: l.code, label: l.name }))}
              />
            </div>
          </div>

          {/* Change password */}
          <form onSubmit={handleChangePasswordSubmit} className="bg-slate-950 p-4.5 rounded-2xl neu-pressed-sm space-y-3.5 max-w-md">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <KeyRound className="w-4.5 h-4.5 text-amber-400" /> Đổi mật khẩu
            </h3>
            <div className="space-y-1 text-xs">
              <label className="text-slate-400 block font-semibold">Mật khẩu hiện tại</label>
              <input
                type="password"
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 text-xs">
                <label className="text-slate-400 block font-semibold">Mật khẩu mới</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
              <div className="space-y-1 text-xs">
                <label className="text-slate-400 block font-semibold">Nhập lại mật khẩu mới</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loadingAction === "password"}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 px-4 rounded-xl cursor-pointer transition-all disabled:opacity-50 text-xs flex items-center gap-1.5"
            >
              <KeyRound className="w-4 h-4" />
              {loadingAction === "password" ? "Đang đổi..." : "Đổi mật khẩu"}
            </button>
          </form>
        </div>
      )}

      {activeTab === "members" && (
        <div className="space-y-6" id="settings-tab-members">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* List of existing members */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
                Danh sách tài khoản gia đình ({users.length})
              </h3>
              
              <div className="divide-y divide-slate-800/60 space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {users.filter(u => !u.isDeleted).map(u => (
                  <div key={u.id} className="pt-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar user={u} className="w-8.5 h-8.5 rounded-xl text-sm" extraClass="shrink-0" />
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-slate-200 font-bold text-[13px] truncate">{u.fullName}</p>
                        <p className="text-slate-500 font-mono text-[10px] truncate">@{u.username} • {new Date(u.createdAt).toLocaleDateString("vi-VN")}</p>
                        {(u.dateOfBirth || u.phone) && (
                          <p className="text-slate-500 text-[10px] flex items-center gap-2.5 flex-wrap">
                            {u.dateOfBirth && (
                              <span className="flex items-center gap-1"><Cake className="w-3 h-3 text-pink-400" />{formatDateVN(u.dateOfBirth)}</span>
                            )}
                            {u.phone && (
                              <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-emerald-400" />{u.phone}</span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${u.role === "admin" ? "bg-red-500/10 text-red-400 border border-red-500/10" : u.role === "member" ? "bg-blue-500/10 text-blue-400 border border-blue-500/10" : u.role === "child" ? "bg-amber-500/10 text-amber-400 border border-amber-500/10" : "bg-green-500/10 text-green-400 border border-green-500/10"}`}>
                          {ROLE_LABELS[u.role]}
                        </span>
                        {u.familyRelation && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            {FAMILY_RELATION_LABELS[u.familyRelation]}
                          </span>
                        )}
                      </div>

                      {/* Reset password (Admin only) */}
                      {currentUser.role === UserRole.ADMIN && (
                        <button
                          onClick={() => handleOpenEditUser(u)}
                          className="p-1.5 bg-slate-950 neu-btn hover:bg-slate-800 text-slate-500 hover:text-sky-400 rounded-lg cursor-pointer transition-all"
                          title={`Sửa thông tin & vai trò của ${u.fullName}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {currentUser.role === UserRole.ADMIN && (
                        <button
                          onClick={() => { setResetTarget(u); setResetNewPwd(""); setActionError(""); setActionSuccess(""); }}
                          className="p-1.5 bg-slate-950 neu-btn hover:bg-slate-800 text-slate-500 hover:text-amber-400 rounded-lg cursor-pointer transition-all"
                          title={`Đặt lại mật khẩu cho ${u.fullName}`}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete member (Admin only, cannot delete self) */}
                      {currentUser.role === UserRole.ADMIN && u.id !== currentUser.id && (
                        <button
                          onClick={() => handleDeleteUserClick(u)}
                          disabled={loadingAction === `delete-user-${u.id}`}
                          className="p-1.5 bg-slate-950 neu-btn hover:bg-slate-800 text-slate-500 hover:text-rose-400 rounded-lg cursor-pointer transition-all disabled:opacity-50"
                          title={`Xóa tài khoản ${u.fullName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Create new member form (Admin only constraint) */}
            <div className="bg-slate-950 p-4.5 rounded-2xl neu-pressed-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <UserPlus className="w-4.5 h-4.5 text-sky-400 animate-pulse" />
                Tạo tài khoản thành viên mới
              </h3>
              
              {currentUser.role !== UserRole.ADMIN ? (
                /* Protected block */
                <div className="py-12 text-center space-y-2">
                  <Lock className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-500">Chỉ Gia Trưởng (Admin) mới có quyền tạo thêm tài khoản thành viên gia đình.</p>
                </div>
              ) : (
                /* Active block */
                <form onSubmit={handleRegisterUser} className="space-y-3.5 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-400 block font-semibold">Tên đăng nhập <span className="text-rose-450">*</span></label>
                    <input 
                      type="text" 
                      placeholder="Viết liền không dấu, ví dụ: bevy"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-400 block font-semibold">Tên xưng hô đầy đủ <span className="text-rose-450">*</span></label>
                    <input 
                      type="text" 
                      placeholder="Ví dụ: Bé Vy (Con út)"
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-slate-400 block font-semibold">Phân quyền</label>
                      <FancySelect
                        value={regRole}
                        onChange={(v) => setRegRole(v as UserRole)}
                        ariaLabel="Phân quyền"
                        className="bg-slate-900"
                        options={ROLE_OPTIONS}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-slate-400 block font-semibold">Vai vế trong gia đình</label>
                      <FancySelect
                        value={regRelation}
                        onChange={(v) => setRegRelation(v as FamilyRelation | "")}
                        ariaLabel="Vai vế trong gia đình"
                        placeholder="— Không đặt —"
                        className="bg-slate-900"
                        options={RELATION_SELECT_OPTIONS}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-400 block font-semibold">Mật khẩu khởi tạo <span className="text-rose-450">*</span></label>
                    <input
                      type="password"
                      placeholder="Mật khẩu riêng..."
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 min-w-0">
                      <label className="text-slate-400 font-semibold flex items-center gap-1"><Cake className="w-3.5 h-3.5 text-pink-400" /> Ngày sinh</label>
                      <DateInputDMY
                        value={regDob}
                        onChange={setRegDob}
                        className="w-full min-w-0 bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <label className="text-slate-400 font-semibold flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-emerald-400" /> Số điện thoại</label>
                      <input
                        type="tel"
                        placeholder="09xx xxx xxx"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        className="w-full min-w-0 bg-slate-900 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <label className="text-slate-400 font-semibold">Giới tính <span className="text-slate-600 font-normal">(để tính BMI)</span></label>
                      <FancySelect
                        value={regGender}
                        onChange={(v) => setRegGender(v as "male" | "female" | "")}
                        ariaLabel="Giới tính"
                        placeholder="Chưa chọn"
                        className="bg-slate-900"
                        options={GENDER_OPTIONS}
                      />
                    </div>
                  </div>

                  {/* Selecting theme avatar tag */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 block font-semibold">Màu sắc thương hiệu cá nhân</label>
                    <div className="flex wrap gap-2.5 pt-1">
                      {colors.map(c => (
                        <button 
                          key={c}
                          type="button"
                          onClick={() => setRegAvatar(c)}
                          className={`w-5.5 h-5.5 rounded-full cursor-pointer border-2 transition-all shrink-0 ${regAvatar === c ? "border-slate-100 scale-110" : "border-transparent opacity-80"}`}
                          title={c}
                          style={{ backgroundColor: c === "bg-indigo-500" ? "#6366f1" : c === "bg-sky-500" ? "#0ea5e9" : c === "bg-emerald-500" ? "#10b981" : c === "bg-teal-500" ? "#14b8a6" : c === "bg-rose-500" ? "#f43f5e" : c === "bg-pink-500" ? "#ec4899" : c === "bg-amber-500" ? "#f59e0b" : "#a855f7" }}
                        />
                      ))}
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={loadingAction === "register"}
                    className="w-full mt-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold py-2 px-4 rounded-xl cursor-pointer transition-all select-none disabled:opacity-50 text-center flex items-center justify-center"
                  >
                    {loadingAction === "register" ? "Đang xử lý đăng ký..." : "Kích hoạt tài khoản"}
                  </button>
                </form>
              )}
            </div>

          </div>
        </div>
      )}

      {activeTab === "backups" && (
        <div className="space-y-5" id="settings-tab-backups">
          <div className="space-y-2 border-b border-slate-800 pb-3 block md:flex md:items-center md:justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                Trữ lượng phục hồi & Sao lưu tệp
              </h3>
              <p className="text-[11px] text-slate-500">Mọi sự kiện, nhiệm vụ, hóa đơn trong gia đình đều được kiểm soát và khôi phục dễ dàng.</p>
            </div>

            {/* Daily backups trigger */}
            <button 
              disabled={currentUser.role !== UserRole.ADMIN || loadingAction === "backup"}
              onClick={handleTriggerManualBackup}
              className="bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-950 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all self-start md:self-auto shrink-0 shadow duration-150 cursor-pointer"
            >
              <Download className="w-4 h-4" /> 
              {loadingAction === "backup" ? "Đang sao lưu tệp..." : "Tạo điểm hồi phục (Backup)"}
            </button>
          </div>

          {currentUser.role !== UserRole.ADMIN ? (
            /* Protected backup panel */
            <div className="py-16 text-center space-y-2 bg-slate-950/40 border border-slate-805 rounded-2xl">
              <Lock className="w-8 h-8 text-slate-605 mx-auto" />
              <p className="text-xs text-slate-500">Người dùng thông thường chỉ có thể xem dữ liệu. Quyền khôi phục và sao lưu thuộc về Gia Trưởng (Admin).</p>
            </div>
          ) : (
            /* Active backup panel */
            <div className="space-y-3.5">
              {/* Sao lưu toàn phần: 1 tệp .zip khôi phục 100% hệ thống trên server mới */}
              <div className="bg-slate-950/60 border border-emerald-500/20 rounded-2xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Archive className="w-4 h-4 text-emerald-400" /> Sao lưu toàn phần — khôi phục 100% hệ thống
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Đóng gói <b className="text-slate-300">toàn bộ</b> dữ liệu + tất cả ảnh hóa đơn, avatar, ảnh ghi chú,
                  ảnh tài sản, tệp giấy tờ + cấu hình (gồm cả Gemini key) vào một tệp <b className="text-slate-300">.zip</b> duy nhất.
                  Tải về và cất ở nơi an toàn <b className="text-slate-300">ngoài server</b> — nếu server hỏng, chỉ cần cài mới
                  rồi bấm "Nhập tệp & khôi phục" là hệ thống trở lại y nguyên thời điểm sao lưu.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    disabled={loadingAction === "full-export" || loadingAction === "full-import"}
                    onClick={handleDownloadFullBackup}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-950 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    {loadingAction === "full-export" ? "Đang đóng gói & tải về..." : "Tải backup toàn phần (.zip)"}
                  </button>
                  <button
                    disabled={loadingAction === "full-export" || loadingAction === "full-import"}
                    onClick={() => fullImportInputRef.current?.click()}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600 border border-rose-500/30 text-rose-400 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    {loadingAction === "full-import" ? "Đang khôi phục toàn phần..." : "Nhập tệp & khôi phục toàn phần"}
                  </button>
                  <input
                    ref={fullImportInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    onChange={handleFullImportFile}
                    className="hidden"
                  />
                </div>
              </div>

              {backups.length === 0 ? (
                <div className="bg-slate-950 p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                  Hệ thống chưa ghi nhận điểm lưu trữ thủ công nào. (Mặc định hệ thống tự động backup mỗi 24H).
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto overscroll-contain rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4 pr-1">
                  {backups.map(b => (
                    <div
                      key={b.id}
                      className="bg-slate-955 border border-slate-800 p-4 rounded-xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:border-slate-700 transition-all text-xs"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${b.type === "auto" ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/10" : "bg-yellow-500/10 text-yellow-500 border border-yellow-500/10"}`}>
                            {b.type === "auto" ? "Tự động" : "Thủ công"}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono italic">{b.sizeKb} KB</span>
                        </div>
                        <h4 className="text-slate-300 font-bold select-all truncate">{b.filename}</h4>
                        <p className="text-slate-500 text-[10px] font-mono">{new Date(b.createdAt).toLocaleString("vi-VN")}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        {/* Restore trigger */}
                        <button 
                          disabled={Boolean(loadingAction && loadingAction.startsWith("restore"))}
                          onClick={() => handleRestoreClick(b.id, b.filename)}
                          className="px-2.5 py-1.5 bg-slate-900 neu-btn hover:text-emerald-450 hover:bg-slate-800 hover:border-slate-700 text-emerald-400 font-bold rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Khôi phục
                        </button>
                        
                        {/* Delete trigger */}
                        <button 
                          onClick={() => handleDeleteBackupClick(b.id)}
                          className="p-1.5 bg-slate-900 neu-btn hover:bg-slate-800 text-slate-500 hover:text-rose-450 rounded-lg cursor-pointer"
                          title="Xóa tệp"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "logs" && (
        <div className="space-y-4" id="settings-tab-logs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              Báo cáo nhật ký gia đình (Audit trail)
            </h3>
            <span className="text-slate-500 text-[10px] font-mono">Tối đa giữ 300 hoạt động gần nhất</span>
          </div>

          {currentUser.role !== UserRole.ADMIN ? (
            /* Protected panel */
            <div className="py-16 text-center space-y-2 bg-slate-950/40 border border-slate-805 rounded-2xl">
              <Lock className="w-8 h-8 text-slate-605 mx-auto" />
              <p className="text-xs text-slate-500">Nhật ký truy vết sâu hệ thống chỉ khả dụng cho quyền Gia Trưởng / Admin.</p>
            </div>
          ) : (
            /* Full scrollable operations trace log */
            <div className="bg-slate-950 neu-pressed-sm rounded-xl max-h-[350px] overflow-y-auto space-y-1.5 p-3 font-mono text-[11px] text-slate-300">
              {activityLogs.length === 0 ? (
                <p className="text-center text-slate-500 py-12 italic">Không có nhật ký hệ thống.</p>
              ) : (
                <>
                  {activityLogs.slice(0, logsLimit).map(log => (
                    <div key={log.id} className="p-1.5 hover:bg-slate-900 rounded flex flex-col md:flex-row md:items-start justify-between gap-1 border-b border-slate-800/30">
                      <div className="space-y-0.5 flex-1">
                        <span className="text-[10px] text-slate-500 mr-2">[{new Date(log.createdAt).toLocaleString("vi-VN")}]</span>
                        <span className="text-sky-400 font-extrabold mr-2">@{log.username}</span>
                        <span className="text-amber-500 font-bold mr-2">&lt;{log.action}&gt;</span>
                        <span className="text-slate-200 pl-1 font-sans">{log.details}</span>
                      </div>
                    </div>
                  ))}
                  {activityLogs.length > logsLimit && (
                    <button
                      onClick={() => setLogsLimit(l => l + 30)}
                      className="w-full mt-2 py-2 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-slate-900 hover:bg-slate-800 neu-btn rounded-lg transition-all cursor-pointer font-sans"
                    >
                      Xem thêm ({activityLogs.length - logsLimit} mục cũ hơn)
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Admin edit-user modal */}
      {editTarget && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-[60] p-4"
        >
          <motion.div
            ref={editTargetRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-800 shrink-0">
              <Avatar user={{ fullName: euFullName || editTarget.fullName, avatarColor: euColor, avatarImage: editTarget.avatarImage }} className="w-10 h-10 rounded-xl text-base" extraClass="shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-100 truncate">Sửa thông tin thành viên</h3>
                <p className="text-[11px] text-slate-500 font-mono truncate">@{editTarget.username}</p>
              </div>
            </div>

            <form onSubmit={handleEditUserSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden text-xs">
              <div className="space-y-3 overflow-y-auto px-5 py-4 flex-1 min-h-0">
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Tên hiển thị <span className="text-rose-450">*</span></label>
                <input
                  type="text"
                  value={euFullName}
                  onChange={(e) => setEuFullName(e.target.value)}
                  className="w-full bg-slate-950 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 block font-semibold">Vai trò (Phân quyền)</label>
                  <FancySelect
                    value={euRole}
                    onChange={(v) => setEuRole(v as UserRole)}
                    ariaLabel="Vai trò (Phân quyền)"
                    options={ROLE_OPTIONS}
                  />
                </div>

                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 block font-semibold">Vai vế trong gia đình</label>
                  <FancySelect
                    value={euRelation}
                    onChange={(v) => setEuRelation(v as FamilyRelation | "")}
                    ariaLabel="Vai vế trong gia đình"
                    placeholder="— Không đặt —"
                    options={RELATION_SELECT_OPTIONS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 font-semibold flex items-center gap-1"><Cake className="w-3.5 h-3.5 text-pink-400" /> Ngày sinh</label>
                  <DateInputDMY
                    value={euDob}
                    onChange={setEuDob}
                    className="w-full min-w-0 bg-slate-950 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 font-semibold flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-emerald-400" /> SĐT</label>
                  <input
                    type="tel"
                    value={euPhone}
                    onChange={(e) => setEuPhone(e.target.value)}
                    placeholder="09xx xxx xxx"
                    className="w-full min-w-0 bg-slate-950 neu-pressed-sm rounded-lg p-2 text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div className="space-y-1 min-w-0">
                  <label className="text-slate-400 font-semibold">Giới tính <span className="text-slate-600 font-normal">(để tính BMI)</span></label>
                  <FancySelect
                    value={euGender}
                    onChange={(v) => setEuGender(v as "male" | "female" | "")}
                    ariaLabel="Giới tính"
                    placeholder="Chưa chọn"
                    options={GENDER_OPTIONS}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-400 block font-semibold">Màu nền avatar</label>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {colors.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEuColor(c)}
                      className={`w-5.5 h-5.5 rounded-full cursor-pointer border-2 transition-all shrink-0 ${euColor === c ? "border-slate-100 scale-110" : "border-transparent opacity-80"}`}
                      style={{ backgroundColor: c === "bg-indigo-500" ? "#6366f1" : c === "bg-sky-500" ? "#0ea5e9" : c === "bg-emerald-500" ? "#10b981" : c === "bg-teal-500" ? "#14b8a6" : c === "bg-rose-500" ? "#f43f5e" : c === "bg-pink-500" ? "#ec4899" : c === "bg-amber-500" ? "#f59e0b" : "#a855f7" }}
                    />
                  ))}
                </div>
              </div>

              </div>

              <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-4 py-2 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200 rounded-xl transition-all cursor-pointer font-bold"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={loadingAction === "edit-user"}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl font-bold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" /> {loadingAction === "edit-user" ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Admin reset-password modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-[60] p-4"
        >
          <motion.div
            ref={resetTargetRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto outline-none"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-100 truncate">Đặt lại mật khẩu</h3>
                <p className="text-[11px] text-slate-500 truncate">cho {resetTarget.fullName} (@{resetTarget.username})</p>
              </div>
            </div>
            <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Mật khẩu mới (tối thiểu 4 ký tự)</label>
                <input
                  autoFocus
                  type="text"
                  value={resetNewPwd}
                  onChange={(e) => setResetNewPwd(e.target.value)}
                  placeholder="Mật khẩu mới cho thành viên..."
                  className="w-full bg-slate-950 neu-pressed-sm focus:border-sky-500 rounded-xl p-2.5 text-slate-200 outline-none font-mono"
                />
              </div>
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200 rounded-xl transition-all cursor-pointer font-bold"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={loadingAction === "reset-pwd"}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  {loadingAction === "reset-pwd" ? "Đang đặt..." : "Đặt lại"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Tính năng "Điểm thưởng cho trẻ" — admin bật/tắt cho cả nhà */}
      {currentUser.role === UserRole.ADMIN && (
        <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <span className="text-base leading-none">⭐</span> Điểm thưởng cho trẻ
              </h3>
              <p className="text-[11px] text-slate-500">
                Bật khu <b className="text-slate-300">Điểm thưởng cho trẻ</b> và <b className="text-slate-300">Cửa hàng đổi thưởng</b> ở
                tab Nhiệm vụ. Mặc định bật khi nhà có tài khoản Trẻ em; tắt đi nếu không dùng.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleRewards}
              disabled={rewardsBusy}
              title={rewardsEnabled ? "Đang BẬT — bấm để tắt" : "Đang TẮT — bấm để bật"}
              className={`shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all disabled:opacity-50 ${rewardsEnabled ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-slate-900 text-slate-500 border-slate-800"}`}
            >
              {rewardsBusy ? "..." : rewardsEnabled ? "ĐANG BẬT" : "ĐANG TẮT"}
            </button>
          </div>
          {rewardsErr && <p className="text-[11px] text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {rewardsErr}</p>}

          {rewardsEnabled && (
            <div className="mt-1 pt-3 border-t border-slate-800/70 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <h4 className="text-[12px] font-bold text-slate-300">Duyệt việc trước khi cộng điểm</h4>
                  <p className="text-[11px] text-slate-500">
                    Trẻ bấm <b className="text-slate-300">"Con làm xong"</b> ở việc có điểm <b className="text-slate-300">lớn hơn</b> ngưỡng
                    này sẽ vào trạng thái <b className="text-amber-400">chờ ba mẹ duyệt</b> — duyệt rồi mới cộng điểm.
                    Việc có điểm ≤ ngưỡng thì bấm xong tự cộng luôn. Đặt <b className="text-slate-300">0</b> để mọi việc có điểm đều phải duyệt.
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    className="w-16 bg-slate-900 neu-pressed-sm rounded-lg px-2.5 py-1.5 text-xs text-slate-200 text-center outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={saveThreshold}
                    disabled={thresholdBusy || thresholdInput === String(rewardApprovalThreshold || 0)}
                    className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 cursor-pointer transition-all disabled:opacity-40"
                  >
                    {thresholdBusy ? "..." : "Lưu"}
                  </button>
                </div>
              </div>
              {thresholdMsg && <p className="text-[11px] text-slate-400">{thresholdMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* Quản lý hạng mục chi phí — admin, trong tab Hệ thống */}
      {activeTab === "backups" && currentUser.role === UserRole.ADMIN && (
        <CategoryManagerCard
          customCategories={customCategories}
          hiddenBuiltinCategories={hiddenBuiltinCategories}
          onSaveCustomCategory={onSaveCustomCategory}
          onDeleteCustomCategory={onDeleteCustomCategory}
          onSetHiddenCategories={onSetHiddenCategories}
          confirm={confirm}
        />
      )}

      {/* Ngôn ngữ hiển thị — tùy chọn cá nhân, lưu trên thiết bị (mọi thành viên) */}
      {activeTab === "backups" && (
        <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Languages className="w-4 h-4 text-sky-400" /> {t("language.name")}
            </h3>
            <p className="text-[11px] text-slate-500">{t("language.description")}</p>
          </div>
          <div className="text-xs max-w-xs">
            <FancySelect
              value={(i18n.resolvedLanguage || i18n.language || "vi").split("-")[0]}
              onChange={(v) => i18n.changeLanguage(v)}
              ariaLabel={t("language.name")}
              className="bg-slate-900"
              options={SUPPORTED_LANGUAGES.map(l => ({ value: l.code, label: `${l.flag}  ${l.label}` }))}
            />
          </div>
        </div>
      )}

      {/* AI (Gemini) API key — admin configurable, no .env editing needed */}
      {activeTab === "backups" && currentUser.role === UserRole.ADMIN && (
        <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" /> Trí tuệ AI (Gemini API Key)
            </h3>
            <p className="text-[11px] text-slate-500">
              {aiKeyStatus?.configured
                ? `Đang dùng key ${aiKeyStatus.masked} (${aiKeyStatus.source === "app" ? "nhập trong app" : "biến môi trường"}). Bật trợ lý AI, gợi ý thực đơn & viết ghi chú.`
                : "Chưa có key. Nhập Gemini API key để bật trợ lý AI, gợi ý thực đơn & viết ghi chú bằng AI."}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              autoComplete="off"
              value={aiKeyInput}
              onChange={(e) => setAiKeyInput(e.target.value)}
              placeholder="Dán Gemini API key (AIza…)"
              className="flex-1 bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500"
            />
            <button
              type="button"
              onClick={() => saveAiKey(false)}
              disabled={aiKeyBusy || !aiKeyInput.trim()}
              className="bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-slate-950 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-all"
            >
              {aiKeyBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Lưu & kiểm tra
            </button>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="text-[11px] text-sky-400 hover:underline">
              Lấy key miễn phí ở Google AI Studio →
            </a>
            {aiKeyStatus?.configured && aiKeyStatus.source === "app" && (
              <button type="button" onClick={() => saveAiKey(true)} disabled={aiKeyBusy} className="text-[11px] text-slate-400 hover:text-rose-400 ml-auto cursor-pointer">
                Xóa key trong app
              </button>
            )}
          </div>
          {aiKeyErr && <p className="text-[11px] text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {aiKeyErr}</p>}
          {aiKeyMsg && <p className="text-[11px] text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 shrink-0" /> {aiKeyMsg}</p>}
        </div>
      )}

      {/* Backup tự động qua Telegram — bản sao offsite hằng đêm, admin only */}
      {activeTab === "backups" && currentUser.role === UserRole.ADMIN && (
        <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Send className="w-4 h-4 text-sky-400" /> Backup tự động qua Telegram
              </h3>
              <p className="text-[11px] text-slate-500">
                {tgStatus?.configured
                  ? `Bot ${tgStatus.maskedToken} → chat ${tgStatus.chatId}.${tgStatus.lastSent ? ` Gửi gần nhất: ${tgStatus.lastSent}.` : " Chưa gửi lần nào."} Tự gửi file .zip toàn phần lúc 2h–4h sáng hằng đêm — Pi hỏng vẫn còn backup trên Telegram.`
                  : "Tạo bot qua @BotFather, lấy chat ID từ @userinfobot rồi dán vào đây — mỗi đêm app tự gửi file backup toàn phần vào chat (tối đa 50MB)."}
              </p>
            </div>
            {/* Công tắc bật/tắt gửi hằng đêm */}
            {tgStatus?.configured && (
              <button
                type="button"
                onClick={() => saveTgConfig({ enabled: !tgStatus.enabled })}
                disabled={tgBusy !== ""}
                title={tgStatus.enabled ? "Đang BẬT gửi hằng đêm — bấm để tắt" : "Đang TẮT — bấm để bật gửi hằng đêm"}
                className={`shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${tgStatus.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-900 text-slate-500 border-slate-800"}`}
              >
                {tgStatus.enabled ? "ĐANG BẬT" : "ĐANG TẮT"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto] gap-2">
            <input
              type="password"
              autoComplete="off"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              placeholder={tgStatus?.configured ? `Bot token (đang dùng ${tgStatus.maskedToken})` : "Bot token (123456:ABC-…)"}
              className="bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500 min-w-0"
            />
            <input
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder="Chat ID"
              className="bg-slate-900 neu-pressed-sm rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500 font-mono"
            />
            <button
              type="button"
              onClick={() => saveTgConfig({
                ...(tgToken.trim() ? { botToken: tgToken.trim() } : {}),
                chatId: tgChatId.trim(),
                enabled: true
              })}
              disabled={tgBusy !== "" || (!tgToken.trim() && !tgStatus?.configured) || !tgChatId.trim()}
              className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-all"
            >
              {tgBusy === "save" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Lưu & bật
            </button>
          </div>

          {tgStatus?.configured && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={sendTgTest}
                disabled={tgBusy !== ""}
                className="bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                <Send className={`w-4 h-4 ${tgBusy === "test" ? "animate-pulse" : ""}`} />
                {tgBusy === "test" ? "Đang nén & gửi..." : "Gửi backup ngay để thử"}
              </button>
            </div>
          )}

          {/* Bản tin tuần gia đình */}
          {tgStatus?.configured && (
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    📋 Bản tin tuần gia đình
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Sáng thứ Hai 7h–10h gửi tóm tắt: chi tiêu tuần, task trễ, lịch & sinh nhật sắp tới, giấy tờ hết hạn.
                    {tgStatus.weeklyDigestEnabled ? " AI viết bản tin thân thiện nếu đã cấu hình Gemini." : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => saveTgConfig({ weeklyDigestEnabled: !tgStatus.weeklyDigestEnabled })}
                  disabled={tgBusy !== ""}
                  title={tgStatus.weeklyDigestEnabled ? "Đang BẬT bản tin tuần — bấm để tắt" : "Đang TẮT — bấm để bật"}
                  className={`shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${tgStatus.weeklyDigestEnabled ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : "bg-slate-900 text-slate-500 border-slate-800"}`}
                >
                  {tgStatus.weeklyDigestEnabled ? "ĐANG BẬT" : "ĐANG TẮT"}
                </button>
              </div>
              <button
                type="button"
                onClick={sendTgDigestTest}
                disabled={tgDigestBusy}
                className="bg-slate-800 hover:bg-slate-700 text-violet-400 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                <Send className={`w-4 h-4 ${tgDigestBusy ? "animate-pulse" : ""}`} />
                {tgDigestBusy ? "Đang tạo & gửi bản tin..." : "Gửi bản tin tuần ngay để thử"}
              </button>
              {tgDigestMsg && (
                <p className={`text-[11px] flex items-center gap-1.5 ${tgDigestMsg.startsWith("Lỗi") ? "text-rose-400" : "text-emerald-400"}`}>
                  {tgDigestMsg.startsWith("Lỗi") ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                  {tgDigestMsg}
                </p>
              )}
            </div>
          )}

          {tgErr && <p className="text-[11px] text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {tgErr}</p>}
          {tgMsg && <p className="text-[11px] text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 shrink-0" /> {tgMsg}</p>}
        </div>
      )}

      {/* Đăng ký lịch gia đình vào app Lịch (ICS subscribe) — mọi thành viên */}
      {activeTab === "backups" && icsUrl && (
        <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" /> Đồng bộ với app Lịch (Apple/Google)
            </h3>
            <p className="text-[11px] text-slate-500">
              Đăng ký link dưới đây trong app Lịch — mọi sự kiện + sinh nhật của cả nhà tự đồng bộ về máy, thêm/sửa trong app là lịch tự cập nhật.
              Trên iPhone: <b className="text-slate-400">Cài đặt → Ứng dụng → Lịch → Tài khoản Lịch → Thêm tài khoản → Khác → Thêm lịch đăng ký</b>, dán link vào.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-[10px] text-slate-300 font-mono truncate select-all">
              {icsUrl}
            </code>
            <button
              type="button"
              onClick={copyIcsUrl}
              className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all ${icsCopied ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-slate-800 hover:bg-slate-700 text-sky-400"}`}
            >
              {icsCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {icsCopied ? "Đã chép" : "Sao chép"}
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            ⚠️ Link chứa mã truy cập lịch của gia đình — chỉ chia sẻ cho người trong nhà. Cần truy cập được server (Tailscale/LAN) thì lịch mới đồng bộ.
          </p>
        </div>
      )}

      {/* Version & self-update */}
      {activeTab === "backups" && (
      <div className="bg-slate-950 neu-pressed-sm rounded-2xl p-4.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Tag className="w-4 h-4 text-sky-400" /> Phiên bản & Cập nhật
            </h3>
            <p className="text-[11px] text-slate-500 font-mono">
              {versionInfo
                ? `Bản: ${versionInfo.shortCommit || versionInfo.version}${versionInfo.buildTime ? ` • build ${new Date(versionInfo.buildTime).toLocaleString("vi-VN")}` : ""}`
                : "Đang tải thông tin phiên bản..."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckUpdate}
            disabled={updateBusy !== ""}
            className="bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${updateBusy === "check" ? "animate-spin" : ""}`} />
            {updateBusy === "check" ? "Đang kiểm tra..." : "Kiểm tra cập nhật"}
          </button>
        </div>

        {updateCheck && (
          <div className="text-xs">
            {updateCheck.updateAvailable === true ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl space-y-2">
                <p className="font-semibold flex items-center gap-1.5">
                  <Rocket className="w-4 h-4" /> Có bản mới! ({updateCheck.currentCommit || "?"} → {updateCheck.latestCommit})
                </p>
                {updateCheck.latestMessage && <p className="text-amber-200/80 font-mono text-[11px]">“{updateCheck.latestMessage}”</p>}

                {currentUser.role === UserRole.ADMIN && updateCheck.canAutoUpdate && (
                  <button
                    type="button"
                    onClick={handleApplyUpdate}
                    disabled={updateBusy !== ""}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {updateBusy === "apply" || updateBusy === "deploying"
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Rocket className="w-4 h-4" />}
                    {updateBusy === "apply" ? "Đang gửi yêu cầu…" : updateBusy === "deploying" ? "Đang cập nhật…" : "Cập nhật ngay"}
                  </button>
                )}
                {!updateCheck.canAutoUpdate && (
                  <p className="text-amber-200/70 text-[11px]">
                    Tự động cập nhật chưa bật. Trên Pi chạy: <code className="bg-slate-900 px-1.5 py-0.5 rounded font-mono">docker compose pull &amp;&amp; docker compose up -d</code>
                  </p>
                )}
              </div>
            ) : updateCheck.updateAvailable === false ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" /> Bạn đang dùng phiên bản mới nhất.
              </div>
            ) : (
              <div className="p-3 bg-slate-800/60 border border-slate-700 text-slate-400 rounded-xl">
                Bản đang chạy là bản dev/local nên không so sánh được với GitHub. (Mới nhất trên GitHub: {updateCheck.latestCommit || "?"})
              </div>
            )}
          </div>
        )}

        {updateMsg && (
          <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            updateDone
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
              : updateBusy === "deploying" || updateBusy === "apply"
                ? "bg-sky-500/10 border-sky-500/20 text-sky-300"
                : "bg-amber-500/10 border-amber-500/20 text-amber-300"
          }`}>
            {updateDone
              ? <CheckCircle className="w-4 h-4 shrink-0" />
              : (updateBusy === "deploying" || updateBusy === "apply")
                ? <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
                : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {updateMsg}
          </div>
        )}
      </div>
      )}

      {/* In-app confirmation dialog */}
      {ConfirmDialog}
    </Reveal>
  );
}
