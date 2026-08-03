/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { 
  Home, 
  CheckSquare, 
  Calendar, 
  FileText, 
  Wallet, 
  Settings2, 
  Bell, 
  LogOut, 
  Menu, 
  X, 
  Wifi,
  AlertCircle,
  Clock,
  Sparkles,
  Info,
  Sun,
  Moon,
  ShoppingCart,
  FolderLock,
  HeartPulse,
  Cpu
} from "lucide-react";
import {
  User,
  UserRole,
  Task,
  FamilyPlan,
  Note,
  FinancialTransaction,
  FamilyAsset,
  Notification,
  RewardPointEntry,
  RewardItem,
  BudgetLimit,
  CustomExpenseCategory,
  RecurringBill,
  MedicationReminder,
  MedicationLog,
  FamilyDocument,
  SavingsGoal,
  Debt,
  VaccinationRecord,
  EmergencyProfile,
  GrowthRecord,
  ROLE_LABELS,
  FAMILY_RELATION_LABELS,
  canAccessFinance,
  canManageMedication
} from "./types.js";
import { Auth } from "./components/Auth.js";
import { Avatar } from "./components/Avatar.js";
import { Dashboard } from "./components/Dashboard.js";
import { Tasks } from "./components/Tasks.js";
import { Schedules } from "./components/Schedules.js";
import { Notes } from "./components/Notes.js";
import { Finance } from "./components/Finance.js";
import { Shopping } from "./components/Shopping.js";
import { Documents } from "./components/Documents.js";
import { ChildHealth } from "./components/ChildHealth.js";
import { Assistant } from "./components/Assistant.js";
import { FabProvider } from "./components/FabHost.js";
import { Settings } from "./components/Settings.js";
import { ServerMonitor } from "./components/ServerMonitor.js";
import { GlobalSearch } from "./components/GlobalSearch.js";
import { useModalA11y } from "./hooks/useModalA11y.js";
import { reloadOnce, scheduleReloadFallback } from "./utils/appReload.js";
import { DEFAULT_VN_LOCATION, findVnLocation } from "./utils/vnLocations.js";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";

type SettingsTab = "profile" | "members" | "backups" | "logs";

// Notification timestamps: show a relative day prefix so older items aren't
// ambiguous (a bare "14:30" could be today or last week).
const formatNotifTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (dayDiff === 0) return `Hôm nay ${time}`;
  if (dayDiff === 1) return `Hôm qua ${time}`;
  return `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${time}`;
};

export default function App() {
  const { t } = useTranslation();

  // Authentication & session status
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem("family_token"));
  const [sessionInitialized, setSessionInitialized] = useState(false);
  
  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("family_theme");
    return (saved as "light" | "dark") || "light";
  });
  const themeFadeTimer = useRef<number | null>(null);

  // Áp theme lên DOM (class + màu thanh trình duyệt) — thuần DOM, không animation
  const applyThemeDom = useCallback((t: "light" | "dark") => {
    document.documentElement.classList.toggle("dark", t === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#171d29" : "#e4e9f1");
  }, []);

  // Lưu + áp theme khi mount và khi theme đổi (không tạo hiệu ứng ở đây; hiệu ứng
  // do handler nút bấm đảm nhiệm để lấy được toạ độ điểm bấm)
  useEffect(() => {
    localStorage.setItem("family_theme", theme);
    applyThemeDom(theme);
  }, [theme, applyThemeDom]);

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Đổi theme với hiệu ứng "đã mắt": theme mới lan tỏa thành vòng tròn từ nút bấm
  // (View Transitions API). iOS/trình duyệt cũ → fallback cross-fade màu dịu.
  const toggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: "light" | "dark" = theme === "light" ? "dark" : "light";
    const startViewTransition = (document as any).startViewTransition?.bind(document);

    if (!startViewTransition || prefersReducedMotion()) {
      // Fallback: cross-fade màu ~0.3s (đã mượt, không giật), tôn trọng reduced-motion
      const root = document.documentElement;
      if (!prefersReducedMotion()) {
        root.classList.add("theme-transition");
        void root.offsetWidth;
        if (themeFadeTimer.current) clearTimeout(themeFadeTimer.current);
        themeFadeTimer.current = window.setTimeout(() => {
          root.classList.remove("theme-transition");
          themeFadeTimer.current = null;
        }, 340);
      }
      setTheme(next);
      return;
    }

    // Toạ độ tâm vòng tròn = tâm nút bấm; bán kính = góc màn xa nhất
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = startViewTransition(() => {
      flushSync(() => {
        applyThemeDom(next); // đổi class ngay để ảnh chụp "new" đúng theme
        setTheme(next);
      });
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`
            ]
          },
          {
            duration: 520,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)"
          }
        );
      })
      .catch(() => {/* nếu trình duyệt huỷ transition thì thôi, theme vẫn đã đổi */});
  };

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Chỉ reload khi controller ĐỔI do một bản SW mới tiếp quản (cập nhật thật).
    // Lần cài đầu tiên, clients.claim() cũng bắn controllerchange nhưng lúc đó
    // chưa có controller cũ — bỏ qua để không tự reload thừa khi mới mở app.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;
      reloadOnce();
    });
    navigator.serviceWorker.register("/sw.js").then(reg => {
      if (reg.waiting) setSwWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setSwWaiting(reg.waiting || installing);
          }
        });
      });
    }).catch(err => {
      console.warn("Service worker registration failed:", err);
    });
  }, []);

  // Push notifications: clear the app-icon badge when the app is opened/focused,
  // and deep-link to the right tab when a push notification is tapped.
  useEffect(() => {
    const KNOWN_TABS = ["dashboard", "tasks", "plans", "notes", "shopping", "medications", "child-health", "finance", "documents", "server", "settings"];
    const clearBadge = () => { try { (navigator as any).clearAppBadge?.(); } catch (e) { /* ignore */ } };

    // Lịch thuốc giờ nằm trong "Sức khỏe gia đình": deep-link "medications" → mở tab
    // child-health và chọn sẵn sub-tab Lịch thuốc.
    const navigateFromNotif = (t: string) => {
      if (t === "medications") {
        setHealthSectionRequest(prev => ({ section: "medication", seq: prev.seq + 1 }));
        setActiveTab("child-health");
      } else {
        setActiveTab(t);
      }
    };

    clearBadge();
    const onVisible = () => { if (document.visibilityState === "visible") clearBadge(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", clearBadge);

    // Cold open from a notification → ?notif_tab=... in the URL.
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("notif_tab");
      if (t && KNOWN_TABS.includes(t)) {
        navigateFromNotif(t);
        params.delete("notif_tab");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
      // PWA shortcut "Nhắc thuốc" mở /?tab=medications → chọn sẵn sub-tab Lịch thuốc.
      if (params.get("tab") === "medications") {
        setHealthSectionRequest(prev => ({ section: "medication", seq: prev.seq + 1 }));
      }
    } catch (e) { /* ignore */ }

    // Warm tap (app already open) → service worker posts a navigation message.
    let onMsg: ((e: MessageEvent) => void) | null = null;
    if ("serviceWorker" in navigator) {
      onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d && d.type === "NOTIF_NAV" && typeof d.tab === "string" && KNOWN_TABS.includes(d.tab)) {
          navigateFromNotif(d.tab);
        }
      };
      navigator.serviceWorker.addEventListener("message", onMsg);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", clearBadge);
      if (onMsg) navigator.serviceWorker.removeEventListener("message", onMsg);
    };
  }, []);

  // PWA install prompt capture + live network status
  useEffect(() => {
    const goOnline = () => setNetworkOnline(true);
    const goOffline = () => setNetworkOnline(false);
    const onBeforeInstall = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* ignore */ }
    setInstallPrompt(null);
  };

  const handleApplyUpdate = () => {
    if (swWaiting) {
      // A new service worker is ready: activate it; controllerchange reloads us.
      // Fallback reload only if controllerchange never fires (reloadOnce dedupes).
      swWaiting.postMessage("SKIP_WAITING");
      scheduleReloadFallback(3000);
    } else {
      // New build live but no waiting SW: a network-first reload fetches it.
      reloadOnce();
    }
  };
  
  // Navigation layout state
  const [activeTab, setActiveTab] = useState<string>(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("tab"); // PWA shortcuts deep-link here
    const raw = fromQuery || localStorage.getItem("family_active_tab") || "dashboard";
    // "medications" giờ là sub-tab bên trong "Sức khỏe gia đình" — chuyển hướng tab cũ đã lưu/deep-link.
    return raw === "medications" ? "child-health" : raw;
  });
  const [settingsTabRequest, setSettingsTabRequest] = useState<{ tab: SettingsTab; seq: number }>({ tab: "profile", seq: 0 });
  // Sub-tab đang yêu cầu bên trong "Sức khỏe gia đình" (deep-link từ thông báo thuốc → mục Lịch thuốc)
  const [healthSectionRequest, setHealthSectionRequest] = useState<{ section: "growth" | "vaccination" | "medication"; seq: number }>({ section: "growth", seq: 0 });
  // Deep-link mở chi tiết một sự kiện lịch (bấm từ "Sự kiện sắp diễn ra" ở Tổng quan → tab Lập lịch mở popup)
  const [planViewRequest, setPlanViewRequest] = useState<{ id: string; seq: number }>({ id: "", seq: 0 });
  const handleViewPlan = (id: string) => {
    setPlanViewRequest(prev => ({ id, seq: prev.seq + 1 }));
    setActiveTab("plans");
  };
  // Sau khi Schedules đã mở popup, xoá id để lần điều hướng thường vào tab Lập lịch
  // (không phải do bấm sự kiện) không bị tự mở lại popup cũ.
  const handleConsumeViewPlan = () => setPlanViewRequest(prev => ({ ...prev, id: "" }));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // PWA: network status, install prompt, and pending service-worker update
  const [networkOnline, setNetworkOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [swWaiting, setSwWaiting] = useState<ServiceWorker | null>(null);
  // True once the server reports a build newer than the one this client booted with.
  const [updateReady, setUpdateReady] = useState(false);
  const bootCommitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    if (!canAccessFinance(currentUser.role) && (activeTab === "finance" || activeTab === "documents")) {
      setActiveTab("dashboard");
      return;
    }
    // Tab quản lý server chỉ dành cho Admin
    if (currentUser.role !== UserRole.ADMIN && activeTab === "server") {
      setActiveTab("dashboard");
      return;
    }
    localStorage.setItem("family_active_tab", activeTab);
  }, [activeTab, currentUser]);

  // Database lists
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<FamilyPlan[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [assets, setAssets] = useState<FamilyAsset[]>([]);
  const [rewardEntries, setRewardEntries] = useState<RewardPointEntry[]>([]);
  const [rewardTotals, setRewardTotals] = useState<Record<string, number>>({});
  const [rewardItems, setRewardItems] = useState<RewardItem[]>([]);
  const [budgets, setBudgets] = useState<BudgetLimit[]>([]);
  // Hạng mục CHI tùy chỉnh (Admin quản lý) + danh sách hạng mục mặc định bị ẩn.
  const [customCategories, setCustomCategories] = useState<CustomExpenseCategory[]>([]);
  const [hiddenBuiltinCategories, setHiddenBuiltinCategories] = useState<string[]>([]);
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [medications, setMedications] = useState<MedicationReminder[]>([]);
  const [medicationLogs, setMedicationLogs] = useState<MedicationLog[]>([]);
  const [vaccinations, setVaccinations] = useState<VaccinationRecord[]>([]);
  const [growthRecords, setGrowthRecords] = useState<GrowthRecord[]>([]);
  const [healthProfiles, setHealthProfiles] = useState<EmergencyProfile[]>([]);
  const [documents, setDocuments] = useState<FamilyDocument[]>([]);
  const [shoppingItems, setShoppingItems] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [widgets, setWidgets] = useState<any>(null);
  const [weatherLoc, setWeatherLoc] = useState<string>(DEFAULT_VN_LOCATION.code);
  const [appVersion, setAppVersion] = useState<string>("");
  // Tính năng "Điểm thưởng cho trẻ" bật/tắt cấp gia đình (admin đổi trong Thiết lập).
  // Mặc định server bật nếu có tài khoản Trẻ. Khởi tạo true để tránh nháy ẩn/hiện.
  const [rewardsEnabled, setRewardsEnabled] = useState<boolean>(true);
  // Ngưỡng tự duyệt: task của trẻ có điểm ≤ ngưỡng thì bấm xong tự cộng; lớn hơn
  // phải chờ ba mẹ duyệt. 0 = mọi task có điểm đều cần duyệt.
  const [rewardApprovalThreshold, setRewardApprovalThreshold] = useState<number>(0);

  // Notifications modal control
  const [notifOpen, setNotifOpen] = useState(false);

  // Server-Sent Events (SSE) reference
  const sseRef = useRef<EventSource | null>(null);

  // Notification popover wrapper (for click-away dismissal)
  const notifRef = useRef<HTMLDivElement | null>(null);

  // Dialog containers (focus trap)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  // Authentication persistence check
  useEffect(() => {
    const savedToken = localStorage.getItem("family_token");
    if (savedToken) {
      fetch(`/api/auth/me`, {
        headers: { "Authorization": `Bearer ${savedToken}` }
      })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error();
        })
        .then(data => {
          setCurrentUser(data.user);
        })
        .catch(() => {
          localStorage.removeItem("family_token");
          setAuthToken(null);
        })
        .finally(() => {
          setSessionInitialized(true);
        });
    } else {
      setSessionInitialized(true);
    }
  }, []);

  // Fetch functions with Bearer authentication (signed session token)
  const getAuthHeader = (): Record<string, string> => {
    return authToken ? { "Authorization": `Bearer ${authToken}` } : {};
  };

  const fetchUsers = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/users", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTasks = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/tasks", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPlans = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/plans", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchNotes = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/notes", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTransactions = async () => {
    if (!currentUser) return;
    // Only adults (Admin/Member) may view the transactions list
    if (!canAccessFinance(currentUser.role)) return;
    try {
      const res = await fetch("/api/finance", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRewards = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/rewards", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setRewardEntries(data.entries || []);
        setRewardTotals(data.totals || {});
        setRewardItems(data.items || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFinancePlanning = async () => {
    if (!currentUser || !canAccessFinance(currentUser.role)) return;
    try {
      const [budgetRes, billRes, assetRes, savingsRes, debtRes, catRes] = await Promise.all([
        fetch("/api/finance/budgets", { headers: getAuthHeader() }),
        fetch("/api/finance/recurring-bills", { headers: getAuthHeader() }),
        fetch("/api/finance/assets", { headers: getAuthHeader() }),
        fetch("/api/finance/savings-goals", { headers: getAuthHeader() }),
        fetch("/api/finance/debts", { headers: getAuthHeader() }),
        fetch("/api/finance/categories", { headers: getAuthHeader() })
      ]);
      if (budgetRes.ok) {
        const data = await budgetRes.json();
        setBudgets(data.budgets || []);
      }
      if (catRes.ok) {
        const data = await catRes.json();
        setCustomCategories(data.customCategories || []);
        setHiddenBuiltinCategories(data.hiddenBuiltinCategories || []);
      }
      if (billRes.ok) {
        const data = await billRes.json();
        setRecurringBills(data.recurringBills || []);
      }
      if (assetRes.ok) {
        const data = await assetRes.json();
        setAssets(data.assets || []);
      }
      if (savingsRes.ok) {
        const data = await savingsRes.json();
        setSavingsGoals(data.savingsGoals || []);
      }
      if (debtRes.ok) {
        const data = await debtRes.json();
        setDebts(data.debts || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMedications = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/medications", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setMedications(data.medications || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMedicationLogs = async () => {
    // Nhật ký liều chỉ dành cho Admin/Member (đồng nhất với route backend).
    if (!currentUser || !canManageMedication(currentUser.role)) return;
    try {
      const res = await fetch("/api/medications/logs", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setMedicationLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchChildHealth = async () => {
    // Sổ sức khỏe cả nhà xem được; chỉ người lớn mới thêm/sửa (chặn ở route ghi).
    if (!currentUser) return;
    try {
      const res = await fetch("/api/child-health", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setVaccinations(data.vaccinations || []);
        setGrowthRecords(data.growthRecords || []);
        setHealthProfiles(data.healthProfiles || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDocuments = async () => {
    // Kho giấy tờ chỉ dành cho Admin/Member (đồng nhất với route backend).
    if (!currentUser || !canAccessFinance(currentUser.role)) return;
    try {
      const res = await fetch("/api/documents", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchNotifications = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/notifications", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchShopping = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/shopping", { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setShoppingItems(data.shoppingItems || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBackupsAndLogs = async () => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
    try {
      const [backupsRes, logsRes] = await Promise.all([
        fetch("/api/admin/backups", { headers: getAuthHeader() }),
        fetch("/api/admin/logs", { headers: getAuthHeader() })
      ]);

      if (backupsRes.ok) {
        const b = await backupsRes.json();
        setBackups(b.backups || []);
      }
      if (logsRes.ok) {
        const l = await logsRes.json();
        setActivityLogs(l.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Địa phương thời tiết lưu riêng theo từng user (localStorage, không đụng DB).
  const weatherLocKey = (uid: string) => `weather_loc_${uid}`;

  const fetchWidgets = async (locOverride?: string) => {
    if (!currentUser) return;
    try {
      // Đọc địa phương của user (ưu tiên override khi vừa đổi để tránh trễ state).
      const code = locOverride ?? localStorage.getItem(weatherLocKey(currentUser.id)) ?? DEFAULT_VN_LOCATION.code;
      const loc = findVnLocation(code);
      const geoQuery = `?lat=${loc.lat}&lon=${loc.lon}&city=${encodeURIComponent(loc.name)}`;
      // Lấy giá hiện tại + lịch sử 7 ngày (cho sparkline tăng trưởng ở Tổng quan)
      const [res, histRes] = await Promise.all([
        fetch(`/api/widgets/overview${geoQuery}`, { headers: getAuthHeader() }),
        fetch("/api/widgets/history?days=7", { headers: getAuthHeader() })
      ]);
      if (res.ok) {
        const data = await res.json();
        const hist = histRes.ok ? await histRes.json() : null;
        setWidgets({ ...data, history: hist?.points || [] });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Admin bật/tắt tính năng Điểm thưởng cho trẻ (cấp gia đình). Server broadcast
  // SETTINGS_UPDATE để các máy khác đồng bộ.
  const handleSetRewardsEnabled = async (enabled: boolean) => {
    const res = await fetch("/api/settings/features", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ rewards: enabled })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Không đổi được cài đặt.");
    }
    const d = await res.json();
    setRewardsEnabled(Boolean(d.rewardsEnabled));
    if (typeof d.rewardApprovalThreshold === "number") setRewardApprovalThreshold(d.rewardApprovalThreshold);
  };

  // Đổi ngưỡng tự duyệt điểm thưởng (admin, trong Thiết lập).
  const handleSetRewardApprovalThreshold = async (threshold: number) => {
    const res = await fetch("/api/settings/features", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ rewardApprovalThreshold: threshold })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Không đổi được cài đặt.");
    }
    const d = await res.json();
    if (typeof d.rewardApprovalThreshold === "number") setRewardApprovalThreshold(d.rewardApprovalThreshold);
  };

  // Người dùng đổi địa phương thời tiết: lưu riêng theo user + lấy lại widget ngay.
  const handleChangeWeatherLoc = (code: string) => {
    if (!currentUser) return;
    setWeatherLoc(code);
    localStorage.setItem(weatherLocKey(currentUser.id), code);
    fetchWidgets(code);
  };

  // Dispatch fully unified refetch sequences
  const fetchAllData = () => {
    fetchUsers();
    fetchTasks();
    fetchPlans();
    fetchNotes();
    fetchTransactions();
    fetchRewards();
    fetchFinancePlanning();
    fetchMedications();
    fetchMedicationLogs();
    fetchChildHealth();
    fetchDocuments();
    fetchShopping();
    fetchNotifications();
    fetchBackupsAndLogs();
    fetchWidgets();
    fetchAppVersion();
  };

  const fetchAppVersion = async () => {
    try {
      const res = await fetch("/api/version", { headers: getAuthHeader(), cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setAppVersion(d.shortCommit || d.version || "");
      if (typeof d.rewardsEnabled === "boolean") setRewardsEnabled(d.rewardsEnabled);
      if (typeof d.rewardApprovalThreshold === "number") setRewardApprovalThreshold(d.rewardApprovalThreshold);
      const commit: string = d.commit || "";
      if (!commit) return; // dev/local build → can't compare reliably
      if (bootCommitRef.current === null) {
        bootCommitRef.current = commit; // remember the build this client loaded with
      } else if (commit !== bootCommitRef.current) {
        setUpdateReady(true); // a newer build is live on the server
      }
    } catch (e) {
      // version is non-critical; ignore
    }
  };

  // Proactively notice a newer server build (manual deploy / cron / Watchtower) so
  // the update banner appears on its own — no manual "Kiểm tra cập nhật" needed.
  useEffect(() => {
    if (!currentUser) return;
    const poke = () => {
      fetchAppVersion();
      navigator.serviceWorker?.getRegistration?.().then(reg => reg?.update()).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === "visible") poke(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", poke);
    const iv = window.setInterval(poke, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", poke);
      window.clearInterval(iv);
    };
  }, [currentUser]);

  // Listen to realtime server pushes (SSE sync connection)
  useEffect(() => {
    if (!currentUser) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    // Nạp địa phương thời tiết đã lưu của user này (mỗi người một cài đặt riêng)
    setWeatherLoc(localStorage.getItem(weatherLocKey(currentUser.id)) || DEFAULT_VN_LOCATION.code);

    // Refresh core states on login
    fetchAllData();

    // Refresh dashboard widgets (weather/markets) periodically
    const widgetTimer = setInterval(() => { fetchWidgets(); }, 10 * 60 * 1000);

    // Establish Server-Sent Events client loop pipeline
    const sse = new EventSource("/api/realtime");
    sseRef.current = sse;

    sse.onopen = () => {
      setIsOnline(true);
    };

    sse.onerror = () => {
      setIsOnline(false);
    };

    sse.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log("⚓ Đã đồng bộ tài liệu thời gian thực:", payload);

        switch (payload.type) {
          case "TASKS_UPDATE":
            fetchTasks();
            fetchRewards();
            fetchNotifications();
            fetchBackupsAndLogs(); // refresh logs
            break;
          case "PLANS_UPDATE":
            fetchPlans();
            fetchNotifications();
            fetchBackupsAndLogs();
            break;
          case "NOTES_UPDATE":
            fetchNotes();
            fetchBackupsAndLogs();
            break;
          case "FINANCE_UPDATE":
            fetchTransactions();
            fetchFinancePlanning();
            fetchBackupsAndLogs();
            break;
          case "REWARDS_UPDATE":
            fetchRewards();
            fetchBackupsAndLogs();
            break;
          case "MEDICATIONS_UPDATE":
            fetchMedications();
            fetchMedicationLogs();
            fetchNotifications();
            fetchBackupsAndLogs();
            break;
          case "SHOPPING_UPDATE":
            fetchShopping();
            fetchBackupsAndLogs();
            break;
          case "DOCUMENTS_UPDATE":
            fetchDocuments();
            fetchBackupsAndLogs();
            break;
          case "CHILD_HEALTH_UPDATE":
            fetchChildHealth();
            fetchNotifications();
            fetchBackupsAndLogs();
            break;
          case "NOTIFICATIONS_UPDATE":
            fetchNotifications();
            break;
          case "USERS_UPDATE":
            fetchUsers();
            fetchBackupsAndLogs();
            break;
          case "BACKUPS_UPDATE":
            fetchBackupsAndLogs();
            break;
          case "SETTINGS_UPDATE":
            fetchAppVersion(); // đồng bộ cờ tính năng (vd: bật/tắt Điểm thưởng)
            break;
          case "RESTORE_COMPLETED":
            // Critical: full server reboot sync
            fetchAllData();
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("SSE message parsing failed:", err);
      }
    };

    return () => {
      clearInterval(widgetTimer);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [currentUser]);

  // Auth helper triggers
  const handleLoginSuccess = (user: User, token: string) => {
    localStorage.setItem("family_token", token);
    localStorage.setItem("family_active_tab", "dashboard");
    setAuthToken(token);
    setCurrentUser(user);
    setActiveTab("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("family_token");
    localStorage.removeItem("family_user_id"); // clean up legacy key
    localStorage.removeItem("family_active_tab");
    setAuthToken(null);
    setCurrentUser(null);
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  };

  const openSettingsTab = (tab: SettingsTab) => {
    setSettingsTabRequest(prev => ({ tab, seq: prev.seq + 1 }));
    setActiveTab("settings");
    setMobileMenuOpen(false);
    if (tab === "backups" || tab === "logs") {
      fetchBackupsAndLogs();
    }
  };

  // Mutations wrappers to connect dashboard callbacks with backend routes
  const handleSaveTask = async (taskData: Partial<Task>) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(taskData)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteTask = async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleAddCommentToTask = async (taskId: string, commentContent: string) => {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ content: commentContent })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  // Người lớn duyệt / trả lại việc trẻ đã báo hoàn thành (cơ chế chờ duyệt điểm thưởng).
  const handleApproveTask = async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}/approve`, {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleRejectTask = async (taskId: string, reason?: string) => {
    const res = await fetch(`/api/tasks/${taskId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ reason: reason || "" })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSavePlan = async (planData: Partial<FamilyPlan>) => {
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(planData)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeletePlan = async (planId: string) => {
    const res = await fetch(`/api/plans/${planId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveNote = async (noteData: Partial<Note>) => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(noteData)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteNote = async (noteId: string) => {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveTransaction = async (txData: Partial<FinancialTransaction>) => {
    const res = await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(txData)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteTransaction = async (txId: string) => {
    const res = await fetch(`/api/finance/${txId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleAddRewardEntry = async (payload: Partial<RewardPointEntry>) => {
    const res = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  // Cửa hàng đổi thưởng: quản lý quà (người lớn) + đổi quà bằng điểm
  const handleSaveRewardItem = async (payload: Partial<RewardItem>) => {
    const res = await fetch("/api/rewards/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteRewardItem = async (id: string) => {
    const res = await fetch(`/api/rewards/items/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleRedeemRewardItem = async (itemId: string, childId: string) => {
    const res = await fetch(`/api/rewards/items/${itemId}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ childId })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSeedDefaultRewardItems = async () => {
    const res = await fetch("/api/rewards/items/seed-defaults", {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleRedeemMysteryItem = async (childId: string) => {
    const res = await fetch("/api/rewards/items/mystery", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ childId })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json() as Promise<{ entry: RewardPointEntry; item: { name: string; emoji?: string }; mysteryCost: number }>;
  };

  const handleSaveBudget = async (payload: Partial<BudgetLimit>) => {
    const res = await fetch("/api/finance/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteBudget = async (id: string) => {
    const res = await fetch(`/api/finance/budgets/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleCarryForwardBudgets = async (month: string) => {
    try {
      const res = await fetch("/api/finance/budgets/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ month })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.budgets) setBudgets(data.budgets);
      }
    } catch {
      /* carry-forward là tiện ích, lỗi không chặn UI */
    }
  };

  // ─── Hạng mục CHI tùy chỉnh (Admin) ──────────────────────────────────────
  // Đọc JSON an toàn: nếu server trả rỗng/không phải JSON (vd route chưa tồn tại vì
  // máy chủ chưa được khởi động lại sau khi cập nhật), báo lỗi rõ ràng thay vì
  // "Unexpected end of JSON input".
  const readJsonOrThrow = async (res: Response, fallbackMsg: string) => {
    const text = await res.text();
    let data: any = {};
    if (text) { try { data = JSON.parse(text); } catch { /* body không phải JSON */ } }
    if (!res.ok) {
      throw new Error(data?.error || (res.status === 404
        ? "Máy chủ chưa có tính năng này — hãy khởi động lại máy chủ (server) rồi thử lại."
        : fallbackMsg));
    }
    return data;
  };

  const handleSaveCustomCategory = async (payload: Partial<CustomExpenseCategory>) => {
    const res = await fetch("/api/finance/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    const data = await readJsonOrThrow(res, "Không lưu được hạng mục");
    setCustomCategories(data.customCategories || []);
    setHiddenBuiltinCategories(data.hiddenBuiltinCategories || []);
    return data;
  };

  const handleDeleteCustomCategory = async (id: string) => {
    const res = await fetch(`/api/finance/categories/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    const data = await readJsonOrThrow(res, "Không xóa được hạng mục");
    setCustomCategories(data.customCategories || []);
    setHiddenBuiltinCategories(data.hiddenBuiltinCategories || []);
    return data;
  };

  const handleSetHiddenCategories = async (hidden: string[]) => {
    const res = await fetch("/api/finance/categories/hidden", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ hidden })
    });
    const data = await readJsonOrThrow(res, "Không lưu được cấu hình hạng mục");
    // res.ok nhưng body rỗng (hiếm) → giữ lựa chọn người dùng vừa bấm.
    setHiddenBuiltinCategories(data.hiddenBuiltinCategories || hidden);
    return data;
  };

  const handleSaveRecurringBill = async (payload: Partial<RecurringBill>) => {
    const res = await fetch("/api/finance/recurring-bills", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handlePayRecurringBill = async (id: string) => {
    const res = await fetch(`/api/finance/recurring-bills/${id}/pay`, {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteRecurringBill = async (id: string) => {
    const res = await fetch(`/api/finance/recurring-bills/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveSavingsGoal = async (payload: Partial<SavingsGoal>) => {
    const res = await fetch("/api/finance/savings-goals", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleDeleteSavingsGoal = async (id: string) => {
    const res = await fetch(`/api/finance/savings-goals/${id}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleContributeSavings = async (goalId: string, amount: number, date: string, note?: string) => {
    const res = await fetch(`/api/finance/savings-goals/${goalId}/contributions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ amount, date, note })
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleRemoveSavingsContribution = async (goalId: string, contributionId: string) => {
    const res = await fetch(`/api/finance/savings-goals/${goalId}/contributions/${contributionId}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleSaveDebt = async (payload: Partial<Debt>) => {
    const res = await fetch("/api/finance/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleDeleteDebt = async (id: string) => {
    const res = await fetch(`/api/finance/debts/${id}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleAddDebtPayment = async (debtId: string, amount: number, date: string, note?: string) => {
    const res = await fetch(`/api/finance/debts/${debtId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ amount, date, note })
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleRemoveDebtPayment = async (debtId: string, paymentId: string) => {
    const res = await fetch(`/api/finance/debts/${debtId}/payments/${paymentId}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleSaveAsset = async (payload: Partial<FamilyAsset>) => {
    const res = await fetch("/api/finance/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteAsset = async (id: string) => {
    const res = await fetch(`/api/finance/assets/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveMedication = async (payload: Partial<MedicationReminder>) => {
    const res = await fetch("/api/medications", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteMedication = async (id: string) => {
    const res = await fetch(`/api/medications/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveVaccination = async (payload: Partial<VaccinationRecord>) => {
    const res = await fetch("/api/child-health/vaccinations", {
      method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeader() }, body: JSON.stringify(payload)
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };
  const handleDeleteVaccination = async (id: string) => {
    const res = await fetch(`/api/child-health/vaccinations/${id}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };
  const handleSaveGrowth = async (payload: Partial<GrowthRecord>) => {
    const res = await fetch("/api/child-health/growth", {
      method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeader() }, body: JSON.stringify(payload)
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };
  const handleDeleteGrowth = async (id: string) => {
    const res = await fetch(`/api/child-health/growth/${id}`, { method: "DELETE", headers: getAuthHeader() });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };
  const handleSaveHealthProfile = async (payload: Partial<EmergencyProfile>) => {
    const res = await fetch("/api/child-health/emergency", {
      method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeader() }, body: JSON.stringify(payload)
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    return res.json();
  };

  const handleSaveDocument = async (payload: Partial<FamilyDocument>) => {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteDocument = async (id: string) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  // Ghi nhận / bỏ đánh dấu một liều thuốc (status: "taken" | "skipped" | "none")
  const handleLogDose = async (
    medicationId: string,
    date: string,
    time: string,
    status: "taken" | "skipped" | "none"
  ) => {
    const res = await fetch("/api/medications/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ medicationId, date, time, status })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleSaveShoppingItem = async (data: any) => {
    const res = await fetch("/api/shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    return res.json();
  };

  const handleToggleShoppingItem = async (id: string) => {
    const res = await fetch(`/api/shopping/${id}/toggle`, {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    return res.json();
  };

  const handleDeleteShoppingItem = async (id: string) => {
    const res = await fetch(`/api/shopping/${id}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    return res.json();
  };

  const handleClearPurchasedShopping = async () => {
    const res = await fetch("/api/shopping/purchased", {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    return res.json();
  };

  const handleClearAllShopping = async () => {
    const res = await fetch("/api/shopping/all", {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    return res.json();
  };

  const handleCreateUser = async (userPayload: any) => {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(userPayload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteUser = async (userId: string) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleUpdateProfile = async (profilePayload: any) => {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(profilePayload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    const data = await res.json();
    // The current user just edited their own profile — reflect it immediately
    if (data.user) {
      setCurrentUser(data.user);
    }
    fetchUsers();
    return data;
  };

  const handleChangePassword = async (payload: { currentPassword: string; newPassword: string }) => {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleResetUserPassword = async (userId: string, newPassword: string) => {
    const res = await fetch(`/api/users/${userId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ newPassword })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleAdminUpdateUser = async (userId: string, data: any) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    // Parse defensively: an empty/non-JSON body (e.g. missing route) must not crash the UI
    const text = await res.text();
    const d = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
    if (!res.ok) {
      throw new Error(d.error || `Máy chủ trả về lỗi ${res.status}. Hãy thử khởi động lại server.`);
    }
    // If the admin edited their own account, reflect it immediately
    if (d.user && currentUser && d.user.id === currentUser.id) {
      setCurrentUser(d.user);
    }
    fetchUsers();
    return d;
  };

  const handleCreateBackup = async () => {
    const res = await fetch("/api/admin/backups", {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleRestoreBackup = async (backupId: string) => {
    const res = await fetch(`/api/admin/backups/${backupId}/restore`, {
      method: "POST",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleDeleteBackup = async (backupId: string) => {
    const res = await fetch(`/api/admin/backups/${backupId}`, {
      method: "DELETE",
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    return res.json();
  };

  const handleMarkNotifRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: "POST",
      headers: getAuthHeader()
    });
    // refresh
    fetchNotifications();
  };

  const handleMarkAllNotifsRead = async () => {
    await fetch(`/api/notifications/read-all`, {
      method: "POST",
      headers: getAuthHeader()
    });
    // refresh
    fetchNotifications();
  };

  // Escape-to-close + background scroll lock for overlay surfaces
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useModalA11y(mobileMenuOpen, closeMobileMenu, mobileMenuRef);

  // Dismiss the notification popover when clicking outside of it
  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [notifOpen]);

  // Compute unread alert notifications
  const unreadNotifs = notifications.filter(n => !n.isRead);

  // Loading window blocker
  if (!sessionInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="space-y-4 text-center">
          <div className="relative w-12 h-12 border-4 border-slate-800 border-t-sky-500 rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-xs font-mono tracking-widest uppercase">Đang khởi tạo máy chủ tổ ấm...</p>
        </div>
      </div>
    );
  }

  // Not logged in -> Show portal page
  if (!currentUser) {
    return <Auth onLoginSuccess={handleLoginSuccess} theme={theme} onToggleTheme={toggleTheme} />;
  }

  // Navigation Links definition
  const navLinks = [
    { id: "dashboard", label: t("nav.dashboard"), icon: Home },
    { id: "tasks", label: t("nav.tasks"), icon: CheckSquare },
    // Only show finance to Admin and Members; hidden from Child and Guest accounts
    ...(canAccessFinance(currentUser.role) ? [{ id: "finance", label: t("nav.finance"), icon: Wallet }] : []),
    { id: "plans", label: t("nav.plans"), icon: Calendar },
    { id: "notes", label: t("nav.notes"), icon: FileText },
    { id: "shopping", label: t("nav.shopping"), icon: ShoppingCart },
    // Sổ sức khỏe cả nhà (gồm Tăng trưởng, Tiêm chủng, Lịch thuốc) — mọi thành viên đều xem được
    { id: "child-health", label: t("nav.childHealth"), icon: HeartPulse },
    ...(canAccessFinance(currentUser.role) ? [{ id: "documents", label: t("nav.documents"), icon: FolderLock }] : []),
    // Theo dõi sức khỏe máy chủ (CPU/RAM/nhiệt độ/ổ đĩa) — chỉ Admin thấy
    ...(currentUser.role === UserRole.ADMIN ? [{ id: "server", label: t("nav.server"), icon: Cpu }] : []),
    { id: "settings", label: t("nav.settings"), icon: Settings2 }
  ];

  return (
    <FabProvider>
    <div className="h-screen overflow-hidden bg-slate-950 flex text-slate-200 selection:bg-sky-200 selection:text-sky-700 font-sans relative">

      {/* PWA: offline banner */}
      {!networkOnline && (
        <div className="fixed top-0 inset-x-0 z-[70] bg-amber-500 text-slate-950 text-[11px] font-bold text-center pb-1.5 px-3 pt-[calc(env(safe-area-inset-top)_+_0.375rem)] shadow-md">
          Đang offline — dữ liệu hiển thị là bản gần nhất, thao tác mới sẽ chờ có mạng.
        </div>
      )}

      {/* PWA: update available (new SW waiting, or server build is newer than ours) */}
      {(swWaiting || updateReady) && (
        <button
          onClick={handleApplyUpdate}
          className="fixed left-1/2 -translate-x-1/2 z-[70] bottom-[calc(1rem+env(safe-area-inset-bottom))] bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" /> Đã có bản mới — Bấm để cập nhật
        </button>
      )}

      {/* Visual glowing particle effects */}
      <div className="absolute top-0 right-10 w-96 h-96 bg-purple-500/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-sky-500/5 rounded-full blur-[140px] pointer-events-none" />

      {/* 1. SIDEBAR Navigation Drawer (Leaning desktop screens) */}
      <aside className="hidden lg:flex h-screen sticky top-0 flex-col w-64 border-r border-slate-850 bg-slate-900/60 backdrop-blur-md justify-between shrink-0 px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] z-20 overflow-hidden">
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-1">
          {/* Main Visual Title */}
          <div className="flex items-center gap-2.5 px-2">
            <div className="bg-sky-500/10 p-2 rounded-xl text-sky-400 border border-sky-400/10 leading-none">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <span className="text-md font-extrabold text-slate-100 block tracking-tight">Family Organizer</span>
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-500">Raspberry Pi 5 Hub</span>
            </div>
          </div>

          {/* List items links */}
          <nav className="space-y-1 text-xs">
            {navLinks.map(link => {
              const Icon = link.icon;
              const isActive = activeTab === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => setActiveTab(link.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold cursor-pointer transition-all ${isActive ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/5" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}
                >
                  <Icon className="w-4.5 h-4.5" />
                  <span>{link.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer details */}
        <div className="shrink-0 space-y-4 pt-4 border-t border-slate-850">
          {/* PWA: nút cài app — đặt trên avatar, không còn nổi đè lên nút thêm nhanh */}
          {installPrompt && (
            <button
              onClick={handleInstallApp}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-500/10"
            >
              <Home className="w-4 h-4" /> Cài app lên máy
            </button>
          )}
          <button
            type="button"
            onClick={() => openSettingsTab("profile")}
            className="w-full flex items-center gap-2.5 px-1.5 py-2 rounded-xl text-xs text-left hover:bg-slate-800/40 focus:outline-none focus:ring-2 focus:ring-sky-500/40 transition-all cursor-pointer"
            title="Mở hồ sơ của tôi"
            aria-label={`Mở hồ sơ của ${currentUser.fullName}`}
          >
            <Avatar user={currentUser} className="w-8.5 h-8.5 rounded-xl text-sm" extraClass="shrink-0" />
            <div className="space-y-0.5 truncate flex-1">
              <span className="font-bold text-slate-100 block truncate">{currentUser.fullName}</span>
              <span className="text-[10px] text-slate-400 font-mono block truncate">
                {ROLE_LABELS[currentUser.role]}{currentUser.familyRelation ? ` • ${FAMILY_RELATION_LABELS[currentUser.familyRelation]}` : ""}{appVersion ? ` • v${appVersion}` : ""}
              </span>
            </div>
          </button>

          <button
            onClick={handleLogout}
            className="w-full text-slate-400 hover:text-rose-400 flex items-center gap-3 px-3 py-2.5 hover:bg-rose-500/5 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <LogOut className="w-4.5 h-4.5" /> Đăng xuất
          </button>
        </div>
      </aside>

      {/* 2. MAIN SCREEN AREA */}
      <div className="flex-1 h-screen min-h-0 flex flex-col min-w-0 pr-0 overflow-hidden">
        
        {/* TOP COMPONENT APP BAR HEADER */}
        <header className="shrink-0 sticky top-0 border-b border-slate-850 bg-slate-900/80 backdrop-blur-md px-5 pb-3.5 pt-[calc(env(safe-area-inset-top)_+_0.875rem)] flex items-center justify-between z-30">
          
          <div className="flex items-center gap-4 min-w-0">
            {/* Mobile menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-400 hover:text-slate-100 bg-slate-950 neu-btn rounded-xl leading-none cursor-pointer"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>

            {/* SSE replication indicators — bản đầy đủ (chữ) từ sm trở lên */}
            <div className="hidden sm:flex items-center gap-2 bg-slate-950 p-2 neu-pressed-sm rounded-xl text-[10px] text-slate-400">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  <span>{t("sync.label")}: <span className="text-emerald-400 font-bold">{t("sync.connected")}</span></span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                  <span>{t("sync.label")}: <span className="text-rose-400 font-bold">{t("sync.disconnected")}</span></span>
                </>
              )}
            </div>

            {/* SSE replication indicators — mobile chỉ hiện icon trạng thái đồng bộ (nổi lên) */}
            <div
              className={`sm:hidden flex items-center justify-center p-2 bg-slate-950 neu-btn rounded-xl leading-none transition-shadow ${isOnline ? "text-emerald-400 shadow-[0_0_10px_-2px] shadow-emerald-500/40" : "text-rose-400"}`}
              title={isOnline ? `${t("sync.label")}: ${t("sync.connected")}` : `${t("sync.label")}: ${t("sync.disconnected")}`}
              aria-label={isOnline ? `${t("sync.label")}: ${t("sync.connected")}` : `${t("sync.label")}: ${t("sync.disconnected")}`}
            >
              {isOnline ? (
                <span className="relative flex items-center justify-center">
                  <Wifi className="w-4.5 h-4.5 animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex w-2 h-2">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
                    <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
                  </span>
                </span>
              ) : (
                <AlertCircle className="w-4.5 h-4.5 animate-bounce" />
              )}
            </div>
          </div>

          {/* User selector, alerts bells */}
          <div className="flex items-center gap-3">

            {/* Tìm kiếm toàn cục (⌘K) — gộp tasks/lịch/ghi chú/thu chi/giấy tờ */}
            <GlobalSearch getAuthHeader={getAuthHeader} onNavigate={tab => setActiveTab(tab)} />

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-950 neu-btn rounded-xl outline-none leading-none cursor-pointer group flex items-center justify-center"
              title={theme === "light" ? t("theme.toDark") : t("theme.toLight")}
            >
              {theme === "light" ? (
                <Moon className="w-4.5 h-4.5 transition-transform group-hover:scale-110" />
              ) : (
                <Sun className="w-4.5 h-4.5 text-amber-500 transition-transform group-hover:rotate-45" />
              )}
            </button>

            {/* Notifications Alert Bells list */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(!notifOpen); fetchNotifications(); }}
                className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-950 neu-btn rounded-xl outline-none leading-none relative cursor-pointer group"
              >
                <Bell className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                {unreadNotifs.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-rose-500 text-slate-950 text-[8px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center border border-slate-950 animate-pulse">
                    {unreadNotifs.length}
                  </span>
                )}
              </button>

              {/* Notif box menu floating absolute */}
              {notifOpen && (
                <div className="absolute right-0 mt-2.5 w-76 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl z-30 font-sans">
                  <div className="flex justify-between items-center pb-2.5 border-b border-slate-800 text-xs text-slate-450 font-bold mb-2">
                    <span className="flex items-center gap-1.5"><Bell className="w-4 h-4 text-sky-400" /> Bản tin ({unreadNotifs.length})</span>
                    {unreadNotifs.length > 0 && (
                      <button 
                        onClick={handleMarkAllNotifsRead}
                        className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        Đọc hết
                      </button>
                    )}
                  </div>

                  <div className="max-h-[220px] overflow-y-auto space-y-2 pr-0.5">
                    {notifications.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic py-6 text-center">Hộp thư trống...</p>
                    ) : (
                      notifications.map(n => (
                        <div 
                          key={n.id} 
                          onClick={() => handleMarkNotifRead(n.id)}
                          className={`p-2 rounded-xl text-left text-[11px] hover:bg-slate-850 relative group cursor-pointer border ${n.isRead ? "bg-slate-950/20 border-transparent text-slate-500" : "bg-slate-950 border-slate-800/60 text-slate-200 font-medium"}`}
                        >
                          <p className="font-bold text-slate-300 pr-4">{n.title}</p>
                          <p className="text-slate-450 mt-0.5 leading-relaxed font-sans">{n.content}</p>
                          <span className="text-[9px] text-slate-500/80 font-mono mt-1 block">{formatNotifTime(n.createdAt)}</span>
                          
                          {!n.isRead && (
                            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-sky-500" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>
        </header>

        {/* WORKSPACE VIEW CONTAINER */}
        <main className="min-h-0 flex-1 px-5 md:px-6 pt-5 md:pt-6 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            {/*
              Bottom padding lives on the (overflowing) content, not <main>:
              a scroll container's own padding-bottom is dropped by browsers when content overflows.
              Extra room so the last widget clears the floating buttons + phone home bar.
            */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              transition={{ duration: 0.15 }}
              className="min-h-full pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]"
            >
              {activeTab === "dashboard" && (
                <Dashboard
                  currentUser={currentUser}
                  users={users}
                  tasks={tasks}
                  plans={plans}
                  notes={notes}
                  transactions={transactions}
                  customCategories={customCategories}
                  activityLogs={activityLogs}
                  widgets={widgets}
                  onViewPlan={handleViewPlan}
                  onNavigate={(tab) => {
                    setActiveTab(tab);
                    // Also query log history if navigating to settings
                    if (tab === "settings") fetchBackupsAndLogs();
                  }}
                />
              )}

              {activeTab === "tasks" && (
                <Tasks 
                  currentUser={currentUser}
                  users={users}
                  tasks={tasks}
                  rewardEntries={rewardEntries}
                  rewardTotals={rewardTotals}
                  rewardItems={rewardItems}
                  onAddReward={handleAddRewardEntry}
                  onSaveRewardItem={handleSaveRewardItem}
                  onDeleteRewardItem={handleDeleteRewardItem}
                  onRedeemRewardItem={handleRedeemRewardItem}
                  onSeedDefaultRewardItems={handleSeedDefaultRewardItems}
                  onRedeemMysteryItem={handleRedeemMysteryItem}
                  onSaveTask={handleSaveTask}
                  onDeleteTask={handleDeleteTask}
                  onAddComment={handleAddCommentToTask}
                  onApproveTask={handleApproveTask}
                  onRejectTask={handleRejectTask}
                  rewardsEnabled={rewardsEnabled}
                  rewardApprovalThreshold={rewardApprovalThreshold}
                />
              )}

              {activeTab === "plans" && (
                <Schedules
                  currentUser={currentUser}
                  users={users}
                  plans={plans}
                  onSavePlan={handleSavePlan}
                  onDeletePlan={handleDeletePlan}
                  requestedViewPlanId={planViewRequest.id}
                  requestedViewPlanSeq={planViewRequest.seq}
                  onConsumeViewPlan={handleConsumeViewPlan}
                />
              )}

              {activeTab === "notes" && (
                <Notes 
                  currentUser={currentUser}
                  users={users}
                  notes={notes}
                  onSaveNote={handleSaveNote}
                  onDeleteNote={handleDeleteNote}
                  authHeaders={getAuthHeader()}
                />
              )}

              {activeTab === "shopping" && (
                <Shopping
                  currentUser={currentUser}
                  users={users}
                  shoppingItems={shoppingItems}
                  onSaveItem={handleSaveShoppingItem}
                  onToggleItem={handleToggleShoppingItem}
                  onDeleteItem={handleDeleteShoppingItem}
                  onClearPurchased={handleClearPurchasedShopping}
                  onClearAll={handleClearAllShopping}
                  authHeaders={getAuthHeader()}
                />
              )}

              {activeTab === "finance" && canAccessFinance(currentUser.role) && (
                <Finance
                  currentUser={currentUser}
                  users={users}
                  transactions={transactions}
                  budgets={budgets}
                  customCategories={customCategories}
                  hiddenBuiltinCategories={hiddenBuiltinCategories}
                  recurringBills={recurringBills}
                  savingsGoals={savingsGoals}
                  debts={debts}
                  assets={assets}
                  widgets={widgets}
                  onSaveTransaction={handleSaveTransaction}
                  onSaveSavingsGoal={handleSaveSavingsGoal}
                  onDeleteSavingsGoal={handleDeleteSavingsGoal}
                  onContributeSavings={handleContributeSavings}
                  onRemoveSavingsContribution={handleRemoveSavingsContribution}
                  onSaveDebt={handleSaveDebt}
                  onDeleteDebt={handleDeleteDebt}
                  onAddDebtPayment={handleAddDebtPayment}
                  onRemoveDebtPayment={handleRemoveDebtPayment}
                  onDeleteTransaction={handleDeleteTransaction}
                  onSaveBudget={handleSaveBudget}
                  onDeleteBudget={handleDeleteBudget}
                  onCarryForwardBudgets={handleCarryForwardBudgets}
                  onSaveRecurringBill={handleSaveRecurringBill}
                  onPayRecurringBill={handlePayRecurringBill}
                  onDeleteRecurringBill={handleDeleteRecurringBill}
                  onSaveAsset={handleSaveAsset}
                  onDeleteAsset={handleDeleteAsset}
                />
              )}

              {activeTab === "child-health" && (
                <ChildHealth
                  currentUser={currentUser}
                  users={users}
                  vaccinations={vaccinations}
                  growthRecords={growthRecords}
                  healthProfiles={healthProfiles}
                  medications={medications}
                  medicationLogs={medicationLogs}
                  onSaveHealthProfile={handleSaveHealthProfile}
                  onSaveVaccination={handleSaveVaccination}
                  onDeleteVaccination={handleDeleteVaccination}
                  onSaveGrowth={handleSaveGrowth}
                  onDeleteGrowth={handleDeleteGrowth}
                  onSaveMedication={handleSaveMedication}
                  onDeleteMedication={handleDeleteMedication}
                  onLogDose={handleLogDose}
                  requestedSection={healthSectionRequest.section}
                  requestedSectionSeq={healthSectionRequest.seq}
                />
              )}

              {activeTab === "documents" && canAccessFinance(currentUser.role) && (
                <Documents
                  currentUser={currentUser}
                  users={users}
                  documents={documents}
                  onSaveDocument={handleSaveDocument}
                  onDeleteDocument={handleDeleteDocument}
                />
              )}

              {activeTab === "server" && currentUser.role === UserRole.ADMIN && (
                <ServerMonitor authHeaders={getAuthHeader()} currentUser={currentUser} />
              )}

              {activeTab === "settings" && (
                <Settings
                  currentUser={currentUser}
                  users={users}
                  activityLogs={activityLogs}
                  backups={backups}
                  onCreateUser={handleCreateUser}
                  onDeleteUser={handleDeleteUser}
                  onUpdateProfile={handleUpdateProfile}
                  onChangePassword={handleChangePassword}
                  onResetUserPassword={handleResetUserPassword}
                  onAdminUpdateUser={handleAdminUpdateUser}
                  requestedTab={settingsTabRequest.tab}
                  requestedTabSeq={settingsTabRequest.seq}
                  onCreateBackup={handleCreateBackup}
                  onRestoreBackup={handleRestoreBackup}
                  onDeleteBackup={handleDeleteBackup}
                  weatherLoc={weatherLoc}
                  onChangeWeatherLoc={handleChangeWeatherLoc}
                  rewardsEnabled={rewardsEnabled}
                  onSetRewardsEnabled={handleSetRewardsEnabled}
                  rewardApprovalThreshold={rewardApprovalThreshold}
                  onSetRewardApprovalThreshold={handleSetRewardApprovalThreshold}
                  customCategories={customCategories}
                  hiddenBuiltinCategories={hiddenBuiltinCategories}
                  onSaveCustomCategory={handleSaveCustomCategory}
                  onDeleteCustomCategory={handleDeleteCustomCategory}
                  onSetHiddenCategories={handleSetHiddenCategories}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* MOBILE FULL-SCREEN MOBILE OVERLAY MENU DRAWER */}
      {mobileMenuOpen && (
        <div 
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-950/90 z-40 lg:hidden flex justify-start backdrop-blur-sm"
        >
          <motion.div
            ref={mobileMenuRef}
            tabIndex={-1}
            initial={{ x: -100 }}
            animate={{ x: 0 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Menu điều hướng"
            className="w-72 h-full bg-slate-900 border-r border-slate-800 px-5 pt-[calc(env(safe-area-inset-top)_+_1.25rem)] pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col justify-between overflow-hidden outline-none"
          >
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
              <div className="flex items-center justify-between border-b border-slate-850 pb-4">
                <div className="flex items-center gap-2">
                  <div className="bg-sky-500/15 p-2 rounded-xl text-sky-450 leading-none">
                    <Home className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-100 block">Family Hub</span>
                    <span className="text-[9px] uppercase font-mono text-slate-500">Raspberry Pi Server</span>
                  </div>
                </div>
                <button 
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-950 border border-slate-800 rounded-lg leading-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Nav links */}
              <nav className="space-y-1 text-xs">
                {navLinks.map(link => {
                  const Icon = link.icon;
                  const isActive = activeTab === link.id;
                  return (
                    <button
                      key={link.id}
                      onClick={() => {
                        setActiveTab(link.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3.5 px-3 py-3 rounded-xl font-bold cursor-pointer transition-all ${isActive ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}
                    >
                      <Icon className="w-4.5 h-4.5" />
                      <span>{link.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Sidebar logout */}
            <div className="shrink-0 space-y-4 pt-4 border-t border-slate-850">
              {/* SSE replication indicators — mobile hiển thị ngay trên phần thông tin user, canh khớp nút cài PWA */}
              <div className="w-full flex items-center gap-2 bg-slate-950 px-3 py-2.5 neu-pressed-sm rounded-xl text-[10px] text-slate-400">
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
                    <span>{t("sync.label")}: <span className="text-emerald-400 font-bold">{t("sync.connected")}</span></span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 animate-bounce shrink-0" />
                    <span>{t("sync.label")}: <span className="text-rose-400 font-bold">{t("sync.disconnected")}</span></span>
                  </>
                )}
              </div>

              {/* PWA: nút cài app — đặt trên avatar, không còn nổi đè lên nút thêm nhanh */}
              {installPrompt && (
                <button
                  onClick={handleInstallApp}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-500/10"
                >
                  <Home className="w-4 h-4" /> Cài app lên máy
                </button>
              )}
              <button
                type="button"
                onClick={() => openSettingsTab("profile")}
                className="w-full flex items-center gap-3 px-1.5 py-2 rounded-xl text-xs text-left hover:bg-slate-800/40 focus:outline-none focus:ring-2 focus:ring-sky-500/40 transition-all cursor-pointer"
                title="Mở hồ sơ của tôi"
                aria-label={`Mở hồ sơ của ${currentUser.fullName}`}
              >
                <Avatar user={currentUser} className="w-8.5 h-8.5 rounded-xl text-sm" extraClass="shrink-0" />
                <div className="space-y-0.5 truncate flex-1">
                  <span className="font-bold text-slate-100 block truncate">{currentUser.fullName}</span>
                  <span className="text-[10px] text-slate-400 font-mono block truncate">
                    {ROLE_LABELS[currentUser.role]}{currentUser.familyRelation ? ` • ${FAMILY_RELATION_LABELS[currentUser.familyRelation]}` : ""}{appVersion ? ` • v${appVersion}` : ""}
                  </span>
                </div>
              </button>

              <button 
                onClick={handleLogout}
                className="w-full text-slate-400 hover:text-rose-400 flex items-center gap-3 px-3 py-3 hover:bg-rose-500/5 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <LogOut className="w-4.5 h-4.5" /> Đăng xuất
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <Assistant currentUser={currentUser} authHeaders={getAuthHeader()} />
    </div>
    </FabProvider>
  );
}
