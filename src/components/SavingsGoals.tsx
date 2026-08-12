/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { PiggyBank, Plus, Trash2, Target, Calendar, ChevronDown, ChevronUp, X } from "lucide-react";
import { SavingsGoal, User, UserRole } from "../types.js";
import { motion, AnimatePresence } from "motion/react";
import { ShimmerLine, Reveal, IconChip } from "./Lively.js";
import { FancySelect } from "./FancySelect.js";
import { DateInputDMY, formatDateVN } from "./DateTimePicker24.js";
import { useTranslation } from "react-i18next";

interface SavingsGoalsProps {
  currentUser: User;
  users: User[];
  savingsGoals: SavingsGoal[];
  onSaveSavingsGoal: (goal: Partial<SavingsGoal>) => Promise<any>;
  onDeleteSavingsGoal: (id: string) => Promise<any>;
  onContributeSavings: (goalId: string, amount: number, date: string, note?: string) => Promise<any>;
  onRemoveSavingsContribution: (goalId: string, contributionId: string) => Promise<any>;
}

const GOAL_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500"
};

const fmtMoney = (n: number) => n.toLocaleString("vi-VN");
const parseMoney = (s: string) => Number(s.replace(/[^\d-]/g, "")) || 0;
const fmtMoneyInput = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("vi-VN") : "";
};
const sumContributions = (g: SavingsGoal) => g.contributions.reduce((s, c) => s + c.amount, 0);

function daysLeft(dateStr?: string): number | null {
  if (!dateStr) return null;
  const p = String(dateStr).split("-");
  if (p.length < 3) return null;
  const target = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayMid.getTime()) / 86400000);
}

export function SavingsGoals({
  currentUser,
  users,
  savingsGoals,
  onSaveSavingsGoal,
  onDeleteSavingsGoal,
  onContributeSavings,
  onRemoveSavingsContribution
}: SavingsGoalsProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(0);
  const [deadline, setDeadline] = useState("");
  const [color, setColor] = useState("emerald");
  const [isShared, setIsShared] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [contribDraft, setContribDraft] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyGoal, setBusyGoal] = useState<string | null>(null);

  const canManageGoal = (goal: SavingsGoal) =>
    goal.creatorId === currentUser.id || (goal.isShared && currentUser.role === UserRole.ADMIN);

  const totals = useMemo(() => {
    let saved = 0, targetSum = 0;
    savingsGoals.forEach(g => { saved += sumContributions(g); targetSum += g.targetAmount; });
    return { saved, targetSum };
  }, [savingsGoals]);

  const colorOptions = useMemo(() => [
    { value: "emerald", label: t("savingsGoals.colorEmerald") },
    { value: "sky",     label: t("savingsGoals.colorSky") },
    { value: "amber",   label: t("savingsGoals.colorAmber") },
    { value: "rose",    label: t("savingsGoals.colorRose") },
    { value: "violet",  label: t("savingsGoals.colorViolet") }
  ], [t]);

  const scopeOptions = useMemo(() => [
    { value: "true",  label: t("savingsGoals.scopeShared") },
    { value: "false", label: t("savingsGoals.scopePrivate") }
  ], [t]);

  const resetForm = () => { setName(""); setTarget(0); setDeadline(""); setColor("emerald"); setIsShared(true); setNote(""); setError(""); };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError(t("savingsGoals.errNameRequired")); return; }
    if (target <= 0) { setError(t("savingsGoals.errAmountZero")); return; }
    setSaving(true);
    try {
      await onSaveSavingsGoal({ name: name.trim(), targetAmount: target, deadline: deadline || undefined, color, isShared, note: note.trim() || undefined });
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || t("savingsGoals.errSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleContribute = async (goal: SavingsGoal, sign: 1 | -1) => {
    const raw = contribDraft[goal.id] || "";
    const amount = parseMoney(raw) * sign;
    if (!amount) return;
    setBusyGoal(goal.id);
    try {
      await onContributeSavings(goal.id, amount, new Date().toISOString().slice(0, 10));
      setContribDraft(prev => ({ ...prev, [goal.id]: "" }));
    } catch (err) {
      console.error("contribution failed", err);
    } finally {
      setBusyGoal(null);
    }
  };

  return (
    <Reveal delay={0.1} className="relative overflow-hidden bg-slate-900 neu-raised rounded-2xl p-5 space-y-4">
      <ShimmerLine accent="emerald" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <IconChip accent="emerald"><PiggyBank className="w-4 h-4" /></IconChip> {t("savingsGoals.title")}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {savingsGoals.length > 0 && (
            <span className="text-[10px] text-slate-500 font-mono">{fmtMoney(totals.saved)} / {fmtMoney(totals.targetSum)} đ</span>
          )}
          <button onClick={() => setShowForm(v => !v)} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> {t("savingsGoals.addBtn")}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-950/40 neu-pressed-sm rounded-xl p-3 overflow-hidden"
          >
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t("savingsGoals.namePlaceholder")} className="sm:col-span-2 bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500" />
            <input inputMode="numeric" value={target > 0 ? fmtMoney(target) : ""} onChange={e => setTarget(parseMoney(e.target.value))} placeholder={t("savingsGoals.amountPlaceholder")} className="bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500" />
            <DateInputDMY value={deadline} onChange={setDeadline} className="bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500 font-mono" />
            <FancySelect value={color} onChange={setColor} ariaLabel={t("savingsGoals.colorAriaLabel")} options={colorOptions} />
            <FancySelect value={isShared ? "true" : "false"} onChange={(v) => setIsShared(v === "true")} ariaLabel={t("savingsGoals.scopeAriaLabel")} options={scopeOptions} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t("savingsGoals.notePlaceholder")} className="sm:col-span-2 bg-slate-950 neu-pressed-sm rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500" />
            {error && <p className="sm:col-span-2 text-[11px] text-rose-400">{error}</p>}
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 rounded-lg px-3 py-2 font-bold cursor-pointer">{t("savingsGoals.saveBtn")}</button>
              <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg px-3 py-2 font-bold cursor-pointer">{t("savingsGoals.cancelBtn")}</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {savingsGoals.length === 0 ? (
        <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">{t("savingsGoals.empty")}</p>
      ) : (
        <div className="space-y-3 max-h-[18rem] overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          {savingsGoals.map(goal => {
            const saved = sumContributions(goal);
            const pct = Math.max(0, Math.min(100, Math.round((saved / goal.targetAmount) * 100)));
            const achieved = saved >= goal.targetAmount;
            const dleft = daysLeft(goal.deadline);
            const isOpen = expanded[goal.id];
            const bar = GOAL_COLORS[goal.color || "emerald"] || GOAL_COLORS.emerald;
            const canManage = canManageGoal(goal);
            return (
              <div key={goal.id} className="bg-slate-950/60 neu-pressed-sm rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5 truncate">
                      <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> {goal.name}
                      {achieved && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded font-bold">{t("savingsGoals.achieved")}</span>}
                    </p>
                    {goal.note && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{goal.note}</p>}
                  </div>
                  {canManage && (
                    <button onClick={() => onDeleteSavingsGoal(goal.id)} className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0" title={t("savingsGoals.deleteTitle")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
                  <div className={`h-full ${achieved ? "bg-emerald-500" : bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-300">{fmtMoney(saved)} / {fmtMoney(goal.targetAmount)} đ</span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">{pct}%</span>
                    {dleft !== null && (
                      <span className={`flex items-center gap-1 font-mono ${dleft < 0 ? "text-rose-400" : dleft <= 30 ? "text-amber-400" : "text-slate-500"}`}>
                        <Calendar className="w-3 h-3" />
                        {dleft < 0 ? t("savingsGoals.lateDays", { n: -dleft }) : t("savingsGoals.daysLeft", { n: dleft })}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    inputMode="numeric"
                    value={contribDraft[goal.id] || ""}
                    onChange={e => setContribDraft(prev => ({ ...prev, [goal.id]: fmtMoneyInput(e.target.value) }))}
                    placeholder={t("savingsGoals.contribPlaceholder")}
                    className="flex-1 min-w-0 bg-slate-950 neu-pressed-sm rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500 text-[11px]"
                  />
                  <button disabled={busyGoal === goal.id} onClick={() => handleContribute(goal, 1)} className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-50" title={t("savingsGoals.contribAddTitle")}>{t("savingsGoals.contribAddBtn")}</button>
                  <button disabled={busyGoal === goal.id} onClick={() => handleContribute(goal, -1)} className="bg-rose-500/10 text-rose-400 border border-rose-500/25 hover:bg-rose-500/20 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-50" title={t("savingsGoals.contribWithdrawTitle")}>{t("savingsGoals.contribWithdrawBtn")}</button>
                </div>

                {goal.contributions.length > 0 && (
                  <div>
                    <button onClick={() => setExpanded(prev => ({ ...prev, [goal.id]: !prev[goal.id] }))} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer">
                      {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} {t("savingsGoals.contribCount", { n: goal.contributions.length })}
                    </button>
                    {isOpen && (
                      <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                        {goal.contributions.map(c => {
                          const by = users.find(u => u.id === c.byId);
                          const canRemove = canManage || c.byId === currentUser.id;
                          return (
                            <div key={c.id} className="flex items-center justify-between text-[10px] bg-slate-900/60 rounded-lg px-2 py-1">
                              <span className="font-mono text-slate-400">{formatDateVN(c.date)}</span>
                              <span className={`font-bold ${c.amount >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{c.amount >= 0 ? "+" : ""}{fmtMoney(c.amount)}đ</span>
                              <span className="text-slate-500 truncate max-w-[70px]">{by?.fullName || ""}</span>
                              {canRemove && (
                                <button onClick={() => onRemoveSavingsContribution(goal.id, c.id)} className="text-slate-600 hover:text-rose-400 cursor-pointer" title={t("savingsGoals.contribRemoveTitle")}>
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Reveal>
  );
}
