/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { HandCoins, Plus, Trash2, Pencil, Calendar, ChevronDown, ChevronUp, X, ArrowDownLeft, ArrowUpRight, Building2, Phone, MapPin, Paperclip } from "lucide-react";
import { Debt, User } from "../types.js";
import { motion, AnimatePresence } from "motion/react";
import { optimizeAndUpload } from "../utils/uploadImage.js";
import { ShimmerLine, Reveal, IconChip } from "./Lively.js";
import { DateInputDMY, formatDateVN } from "./DateTimePicker24.js";
import { debtPaid, debtRemaining } from "../utils/debt.js";
import { useTranslation } from "react-i18next";

interface DebtTrackerProps {
  currentUser: User;
  users: User[];
  debts: Debt[];
  onSaveDebt: (debt: Partial<Debt>) => Promise<any>;
  onDeleteDebt: (id: string) => Promise<any>;
  onAddDebtPayment: (debtId: string, amount: number, date: string, note?: string) => Promise<any>;
  onRemoveDebtPayment: (debtId: string, paymentId: string) => Promise<any>;
}

const fmtMoney = (n: number) => n.toLocaleString("vi-VN");
const parseMoney = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const fmtMoneyInput = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("vi-VN") : "";
};
const paidOf = debtPaid;

function daysLeft(dateStr?: string): number | null {
  if (!dateStr) return null;
  const p = String(dateStr).split("-");
  if (p.length < 3) return null;
  const target = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const t = new Date();
  const todayMid = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((target.getTime() - todayMid.getTime()) / 86400000);
}

export function DebtTracker({
  currentUser,
  users,
  debts,
  onSaveDebt,
  onDeleteDebt,
  onAddDebtPayment,
  onRemoveDebtPayment
}: DebtTrackerProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [direction, setDirection] = useState<"borrowed" | "lent">("borrowed");
  const [counterparty, setCounterparty] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [amount, setAmount] = useState(0);
  const [loanDate, setLoanDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [payDraft, setPayDraft] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const totals = useMemo(() => {
    let owe = 0, lent = 0;
    debts.forEach(d => {
      if (d.isSettled) return;
      const remaining = debtRemaining(d);
      if (remaining <= 0) return;
      if (d.direction === "borrowed") owe += remaining; else lent += remaining;
    });
    return { owe, lent };
  }, [debts]);

  const resetForm = () => {
    setEditingId(null);
    setDirection("borrowed"); setCounterparty(""); setAddress(""); setPhone(""); setBankName("");
    setAttachments([]); setAmount(0); setLoanDate(new Date().toISOString().slice(0, 10)); setDueDate(""); setNote(""); setError("");
  };

  const toggleCreateForm = () => {
    if (showForm) { resetForm(); setShowForm(false); }
    else { resetForm(); setShowForm(true); }
  };

  const handleEdit = (debt: Debt) => {
    setEditingId(debt.id);
    setDirection(debt.direction === "lent" ? "lent" : "borrowed");
    setCounterparty(debt.counterparty || "");
    setAddress(debt.address || "");
    setPhone(debt.phone || "");
    setBankName(debt.bankName || "");
    setAttachments(debt.attachments || []);
    setAmount(debt.amount || 0);
    setLoanDate(debt.loanDate || new Date().toISOString().slice(0, 10));
    setDueDate(debt.dueDate || "");
    setNote(debt.note || "");
    setError("");
    setShowForm(true);
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setError("");
    setUploading(true);
    try {
      const remaining = Math.max(0, 12 - attachments.length);
      for (const file of files.slice(0, remaining)) {
        const uploaded = await optimizeAndUpload(file, "debts", {
          maxSourceBytes: 20 * 1024 * 1024,
          targetBytes: 600 * 1024,
          maxSizes: [1280, 1024, 768],
          qualities: [0.82, 0.72, 0.62],
          backgroundColor: "#ffffff"
        });
        setAttachments(prev => [...prev, uploaded.url]);
      }
    } catch (err: any) {
      setError(err.message || t("debtTracker.errUploadImage"));
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!counterparty.trim()) { setError(t("debtTracker.errCounterpartyRequired")); return; }
    if (amount <= 0) { setError(t("debtTracker.errAmountZero")); return; }
    if (!loanDate) { setError(t("debtTracker.errLoanDateRequired")); return; }
    if (!dueDate) { setError(t("debtTracker.errDueDateRequired")); return; }
    if (dueDate < loanDate) { setError(t("debtTracker.errDueDateOrder")); return; }
    setSaving(true);
    try {
      await onSaveDebt({
        ...(editingId ? { id: editingId } : {}),
        direction,
        counterparty: counterparty.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        bankName: bankName.trim() || undefined,
        attachments: attachments.length ? attachments : undefined,
        amount,
        loanDate,
        dueDate,
        note: note.trim() || undefined
      });
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || t("debtTracker.errSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handlePay = async (debt: Debt) => {
    const amt = parseMoney(payDraft[debt.id] || "");
    if (!amt) return;
    setBusy(debt.id);
    try {
      await onAddDebtPayment(debt.id, amt, new Date().toISOString().slice(0, 10));
      setPayDraft(prev => ({ ...prev, [debt.id]: "" }));
    } catch (err) {
      console.error("payment failed", err);
    } finally {
      setBusy(null);
    }
  };

  const renderDebt = (debt: Debt) => {
    const paid = paidOf(debt);
    const remaining = Math.max(0, debt.amount - paid);
    const pct = Math.min(100, Math.round((paid / debt.amount) * 100));
    const settled = debt.isSettled || remaining <= 0;
    const dleft = daysLeft(debt.dueDate);
    const isOpen = expanded[debt.id];
    const isBorrowed = debt.direction === "borrowed";
    return (
      <div key={debt.id} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5 truncate">
              {isBorrowed ? <ArrowDownLeft className="w-3.5 h-3.5 text-rose-400 shrink-0" /> : <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
              {debt.counterparty}
              {settled && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded font-bold">{t("debtTracker.settledBadge")}</span>}
            </p>
            {(debt.bankName || debt.phone || debt.address) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1 text-[10px] text-slate-500">
                {debt.bankName && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {debt.bankName}</span>}
                {debt.phone && <a href={`tel:${debt.phone}`} className="flex items-center gap-1 text-sky-400 hover:underline"><Phone className="w-3 h-3" /> {debt.phone}</a>}
                {debt.address && <span className="flex items-center gap-1 min-w-0"><MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{debt.address}</span></span>}
              </div>
            )}
            {debt.note && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{debt.note}</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => handleEdit(debt)} className="p-1.5 text-slate-500 hover:text-amber-400 cursor-pointer" title={t("debtTracker.editTooltip")}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDeleteDebt(debt.id)} className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer" title={t("debtTracker.deleteTooltip")}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {debt.attachments && debt.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {debt.attachments.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={t("debtTracker.attachmentAlt", { n: i + 1 })}
                onClick={() => setLightbox(url)}
                className="w-12 h-12 object-cover rounded-lg neu-btn cursor-pointer hover:border-amber-500 transition-colors"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        )}

        <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
          <div className={`h-full ${settled ? "bg-emerald-500" : isBorrowed ? "bg-rose-500" : "bg-sky-500"} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono text-slate-300">{t("debtTracker.remaining", { remaining: fmtMoney(remaining), total: fmtMoney(debt.amount) })}</span>
          {dleft !== null && !settled && (
            <span className={`flex items-center gap-1 font-mono ${dleft < 0 ? "text-rose-400" : dleft <= 7 ? "text-amber-400" : "text-slate-500"}`}>
              <Calendar className="w-3 h-3" />
              {dleft < 0 ? t("debtTracker.lateDays", { n: -dleft }) : t("debtTracker.daysLeft", { n: dleft })}
            </span>
          )}
        </div>

        {(debt.loanDate || debt.dueDate) && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{debt.loanDate ? formatDateVN(debt.loanDate) : "—"}</span>
            <span className="text-slate-600">→</span>
            <span className={!settled && dleft !== null && dleft <= 7 ? (dleft < 0 ? "text-rose-400" : "text-amber-400") : "text-slate-400"}>{debt.dueDate ? formatDateVN(debt.dueDate) : "—"}</span>
          </div>
        )}

        {!settled && (
          <div className="flex items-center gap-1.5">
            <input
              inputMode="numeric"
              value={payDraft[debt.id] || ""}
              onChange={e => setPayDraft(prev => ({ ...prev, [debt.id]: fmtMoneyInput(e.target.value) }))}
              placeholder={isBorrowed ? t("debtTracker.payPlaceholderBorrowed") : t("debtTracker.payPlaceholderLent")}
              className="flex-1 min-w-0 bg-slate-950 neu-pressed-sm rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500 text-[11px]"
            />
            <button disabled={busy === debt.id} onClick={() => handlePay(debt)} className="bg-sky-500/15 text-sky-400 border border-sky-500/30 hover:bg-sky-500/25 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-50">
              {isBorrowed ? t("debtTracker.payBtnBorrowed") : t("debtTracker.payBtnLent")}
            </button>
          </div>
        )}

        {debt.payments.length > 0 && (
          <div>
            <button onClick={() => setExpanded(prev => ({ ...prev, [debt.id]: !prev[debt.id] }))} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer">
              {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {isBorrowed
                ? t("debtTracker.paymentsCountBorrowed", { n: debt.payments.length })
                : t("debtTracker.paymentsCountLent", { n: debt.payments.length })}
            </button>
            {isOpen && (
              <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                {debt.payments.map(p => {
                  const by = users.find(u => u.id === p.byId);
                  return (
                    <div key={p.id} className="flex items-center justify-between text-[10px] bg-slate-900/60 rounded-lg px-2 py-1">
                      <span className="font-mono text-slate-400">{formatDateVN(p.date)}</span>
                      <span className="font-bold text-emerald-400">{fmtMoney(p.amount)}đ</span>
                      <span className="text-slate-500 truncate max-w-[70px]">{by?.fullName || ""}</span>
                      <button onClick={() => onRemoveDebtPayment(debt.id, p.id)} className="text-slate-600 hover:text-rose-400 cursor-pointer" title={t("common.delete")}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const borrowed = debts.filter(d => d.direction === "borrowed");
  const lent = debts.filter(d => d.direction === "lent");

  return (
    <Reveal delay={0.14} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-4">
      <ShimmerLine accent="amber" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <IconChip accent="amber"><HandCoins className="w-4 h-4" /></IconChip> {t("debtTracker.title")}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {(totals.owe > 0 || totals.lent > 0) && (
            <span className="text-[10px] font-mono text-slate-500">
              {t("debtTracker.totalOwed")} <span className="text-rose-400 font-bold">{fmtMoney(totals.owe)}</span> · {t("debtTracker.totalLent")} <span className="text-emerald-400 font-bold">{fmtMoney(totals.lent)}</span>
            </span>
          )}
          <button onClick={toggleCreateForm} className="bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> {t("debtTracker.addBtn")}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-950/40 neu-pressed-sm rounded-xl p-3 overflow-hidden"
          >
            {editingId && (
              <div className="sm:col-span-2 flex items-center gap-1.5 text-[11px] font-bold text-amber-400">
                <Pencil className="w-3.5 h-3.5" /> {t("debtTracker.editingIndicator")}
              </div>
            )}
            <div className="sm:col-span-2 grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg neu-pressed-sm font-bold text-center">
              <button type="button" onClick={() => setDirection("borrowed")} className={`py-1.5 rounded-md cursor-pointer transition-all ${direction === "borrowed" ? "bg-rose-500 text-slate-950" : "text-slate-400"}`}>{t("debtTracker.directionBorrowed")}</button>
              <button type="button" onClick={() => setDirection("lent")} className={`py-1.5 rounded-md cursor-pointer transition-all ${direction === "lent" ? "bg-emerald-500 text-slate-950" : "text-slate-400"}`}>{t("debtTracker.directionLent")}</button>
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[10px] text-slate-500 font-semibold">{t("debtTracker.counterpartyLabel")} <span className="text-rose-400">*</span></label>
              <input value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder={direction === "borrowed" ? t("debtTracker.counterpartyPlaceholderBorrowed") : t("debtTracker.counterpartyPlaceholderLent")} className="w-full bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500" />
            </div>
            <input inputMode="numeric" value={amount > 0 ? fmtMoney(amount) : ""} onChange={e => setAmount(parseMoney(e.target.value))} placeholder={t("debtTracker.amountPlaceholder")} className="sm:col-span-2 bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500" />
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-semibold">{direction === "borrowed" ? t("debtTracker.loanDateBorrowed") : t("debtTracker.loanDateLent")} <span className="text-rose-400">*</span></label>
              <DateInputDMY value={loanDate} max={dueDate || undefined} onChange={setLoanDate} className="w-full bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500 font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-semibold">{t("debtTracker.dueDateLabel")} <span className="text-rose-400">*</span></label>
              <DateInputDMY value={dueDate} min={loanDate || undefined} onChange={setDueDate} className="w-full bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500 font-mono" />
            </div>

            <div className="relative">
              <Building2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder={t("debtTracker.bankPlaceholder")} className="w-full bg-slate-950 neu-pressed-sm rounded-lg pl-8 pr-3 py-2 text-slate-200 outline-none focus:border-amber-500" />
            </div>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t("debtTracker.phonePlaceholder")} className="w-full bg-slate-950 neu-pressed-sm rounded-lg pl-8 pr-3 py-2 text-slate-200 outline-none focus:border-amber-500" />
            </div>
            <div className="sm:col-span-2 relative">
              <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder={t("debtTracker.addressPlaceholder")} className="w-full bg-slate-950 neu-pressed-sm rounded-lg pl-8 pr-3 py-2 text-slate-200 outline-none focus:border-amber-500" />
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t("debtTracker.notePlaceholder")} className="sm:col-span-2 bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500" />

            <div className="sm:col-span-2 space-y-2 bg-slate-950/40 neu-pressed-sm rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-400 font-semibold flex items-center gap-1"><Paperclip className="w-3 h-3" /> {t("debtTracker.attachmentsLabel")}</label>
                <span className="text-[9px] text-slate-600 font-mono">{attachments.length}/12</span>
              </div>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((url, i) => (
                    <div key={url} className="relative group">
                      <img src={url} alt={t("debtTracker.attachmentFormAlt", { n: i + 1 })} onClick={() => setLightbox(url)} className="w-14 h-14 object-cover rounded-lg border border-slate-700 cursor-pointer" referrerPolicy="no-referrer" />
                      <button type="button" onClick={() => setAttachments(prev => prev.filter(u => u !== url))} className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full p-0.5 shadow cursor-pointer" title={t("debtTracker.removeAttachmentTitle")}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {attachments.length < 12 && (
                <input type="file" accept="image/*,.heic,.heif" multiple onChange={handleAttach} disabled={uploading} className="w-full text-slate-400 font-mono text-[10px] file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10px] file:font-semibold file:bg-slate-800 file:text-amber-400 file:cursor-pointer disabled:opacity-50" />
              )}
              {uploading && <p className="text-[10px] text-amber-400">{t("debtTracker.uploading")}</p>}
            </div>

            {error && <p className="sm:col-span-2 text-[11px] text-rose-400">{error}</p>}
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" disabled={saving || uploading} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 rounded-lg px-3 py-2 font-bold cursor-pointer">
                {saving ? t("debtTracker.saving") : editingId ? t("debtTracker.updateBtn") : t("debtTracker.saveBtn")}
              </button>
              <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg px-3 py-2 font-bold cursor-pointer">{t("common.cancel")}</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {debts.length === 0 ? (
        <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">{t("debtTracker.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1"><ArrowDownLeft className="w-3.5 h-3.5" /> {t("debtTracker.sectionBorrowed")}</p>
            <div className="space-y-2 max-h-[18rem] overflow-y-auto overscroll-contain scrollbar-thin pr-1">
              {borrowed.length === 0 ? <p className="text-[10px] text-slate-600 px-1">{t("debtTracker.sectionEmpty")}</p> : borrowed.map(renderDebt)}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5" /> {t("debtTracker.sectionLent")}</p>
            <div className="space-y-2 max-h-[18rem] overflow-y-auto overscroll-contain scrollbar-thin pr-1">
              {lent.length === 0 ? <p className="text-[10px] text-slate-600 px-1">{t("debtTracker.sectionEmpty")}</p> : lent.map(renderDebt)}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 cursor-pointer"
          >
            <div className="relative max-w-full max-h-[85vh] p-1.5 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
              <img src={lightbox} alt={t("debtTracker.lightboxAlt")} className="max-w-full max-h-[80vh] object-contain rounded-xl" referrerPolicy="no-referrer" />
              <button onClick={() => setLightbox(null)} className="absolute top-3 right-3 bg-slate-950/80 hover:bg-slate-800 p-2 text-slate-200 neu-btn rounded-lg cursor-pointer" title={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reveal>
  );
}
