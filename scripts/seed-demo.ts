#!/usr/bin/env tsx
/**
 * Seed script — tạo dữ liệu demo cho môi trường dev local.
 *
 * Chạy:  npm run seed:demo
 *
 * ⚠️  Script này XÓA TOÀN BỘ dữ liệu hiện tại trong family.db và thay bằng
 *     data ảo. CHỈ chạy trên máy dev — tuyệt đối không chạy production.
 *
 * Data ảo: gia đình 4 người (Ba / Mẹ / Bé Bin / Bé Na), đủ dữ liệu để
 * demo tất cả các tab: Tasks, Plans, Notes, Finance (+ Assets/Budgets/
 * Bills/Goals/Debts), Health (tăng trưởng/tiêm chủng/thuốc), Documents,
 * Shopping, Rewards.
 */

import crypto from "crypto";
import { sqliteLoad, sqliteSave } from "../server/sqlite.js";
import {
  UserRole,
  TaskStatus,
  TaskPriority,
  TransactionType,
  ExpenseCategory,
  AccountType,
} from "../src/types.js";
import type { FamilyOrganizerDB } from "../src/types.js";

// ─── guard ───────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === "production") {
  console.error("❌  Từ chối chạy seed trên môi trường production!");
  process.exit(1);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const NOW = new Date();

/** Ngày YYYY-MM-DD cách hôm nay `offset` ngày (âm = quá khứ). */
const day = (offset = 0): string => {
  const d = new Date(NOW);
  d.setDate(NOW.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** ISO timestamp cách hôm nay `offset` ngày. */
const ts = (offset = 0, hour = 8): string => {
  const d = new Date(NOW);
  d.setDate(NOW.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** "YYYY-MM-DD HH:mm" dùng cho task.dueDate và plan.startDate. */
const dt = (offset = 0, time = "08:00"): string => `${day(offset)} ${time}`;

let _seq = 1;
const id = (prefix: string) => `${prefix}_${String(_seq++).padStart(4, "0")}`;

/** Hash mật khẩu — cùng thuật toán với server/db.ts (PBKDF2, 120 000 vòng). */
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(plain, salt, 120_000, 64, "sha512").toString("hex");
  return `${salt}$${hash}`;
}

// ─── user ids ─────────────────────────────────────────────────────────────────

const U_BA  = "user_ba";
const U_ME  = "user_me";
const U_BIN = "user_bin";
const U_NA  = "user_na";

// ─── 1. USERS ─────────────────────────────────────────────────────────────────

const users: FamilyOrganizerDB["users"] = [
  {
    id: U_BA,
    username: "ba",
    fullName: "Nguyễn Văn Minh",
    role: UserRole.ADMIN,
    familyRelation: "ba",
    avatarColor: "bg-blue-500",
    dateOfBirth: "1985-03-15",
    gender: "male",
    phone: "0901234567",
    passwordHash: hashPassword("123456"),
    createdAt: ts(-180),
  },
  {
    id: U_ME,
    username: "me",
    fullName: "Trần Thị Thu",
    role: UserRole.MEMBER,
    familyRelation: "me",
    avatarColor: "bg-pink-500",
    // sinh nhật 22/7 — 2 ngày nữa để thấy nhắc trên dashboard
    dateOfBirth: "1987-07-22",
    gender: "female",
    phone: "0912345678",
    passwordHash: hashPassword("123456"),
    createdAt: ts(-180),
  },
  {
    id: U_BIN,
    username: "bin",
    fullName: "Nguyễn Minh Bình",
    role: UserRole.CHILD,
    familyRelation: "con",
    avatarColor: "bg-orange-500",
    dateOfBirth: "2016-11-08",
    gender: "male",
    passwordHash: hashPassword("123456"),
    createdAt: ts(-180),
  },
  {
    id: U_NA,
    username: "na",
    fullName: "Nguyễn Minh Na",
    role: UserRole.CHILD,
    familyRelation: "con",
    avatarColor: "bg-purple-500",
    dateOfBirth: "2019-04-12",
    gender: "female",
    passwordHash: hashPassword("123456"),
    createdAt: ts(-180),
  },
];

// ─── 2. TASKS ─────────────────────────────────────────────────────────────────

const tasks: FamilyOrganizerDB["tasks"] = [
  // ── Hoàn thành
  {
    id: id("task"), title: "Trả tiền điện tháng 6",
    description: "Chuyển khoản qua app ngân hàng trước 10/7.",
    status: TaskStatus.COMPLETED, priority: TaskPriority.HIGH,
    dueDate: dt(-10, "10:00"), creatorId: U_BA, assigneeId: U_BA,
    isShared: false, tags: ["tài chính"], rewardPoints: 0,
    completedById: U_BA, completedAt: ts(-12),
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [],
    createdAt: ts(-20), updatedAt: ts(-12),
  },
  {
    id: id("task"), title: "Họp phụ huynh — Bé Bin",
    description: "Họp cuối năm học, nhớ cầm sổ liên lạc.",
    status: TaskStatus.COMPLETED, priority: TaskPriority.MEDIUM,
    dueDate: dt(-14, "17:30"), creatorId: U_ME, assigneeId: U_ME,
    isShared: false, tags: ["học tập"], rewardPoints: 0,
    completedById: U_ME, completedAt: ts(-14),
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [],
    createdAt: ts(-20), updatedAt: ts(-14),
  },
  {
    id: id("task"), title: "Đặt lịch bảo dưỡng xe máy",
    description: "Xe Sh đã đến 3.000 km, cần thay nhớt.",
    status: TaskStatus.COMPLETED, priority: TaskPriority.LOW,
    dueDate: dt(-5, "09:00"), creatorId: U_BA, assigneeId: U_BA,
    isShared: false, tags: ["xe cộ"], rewardPoints: 0,
    completedById: U_BA, completedAt: ts(-6),
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [],
    createdAt: ts(-10), updatedAt: ts(-6),
  },
  // ── Đang làm
  {
    id: id("task"), title: "Mua đồng phục năm học mới cho Bin và Na",
    description: "Size Bin: 130, Na: 110. Hỏi số điện thoại nhà trường để đặt sớm.",
    status: TaskStatus.IN_PROGRESS, priority: TaskPriority.MEDIUM,
    dueDate: dt(12, "12:00"), creatorId: U_ME, assigneeId: U_ME,
    isShared: false, tags: ["học tập", "mua sắm"], rewardPoints: 0,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [
      {
        id: id("cmt"), userId: U_BA, username: "ba",
        content: "Trường gửi link đặt online rồi nè, mình vào group Zalo để lấy link.",
        createdAt: ts(-1),
      },
    ],
    history: [], createdAt: ts(-3), updatedAt: ts(-1),
  },
  {
    id: id("task"), title: "Kiểm tra đăng kiểm xe ô tô",
    description: "Đăng kiểm hết hạn 15/9, cần đặt lịch sớm.",
    status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH,
    dueDate: dt(20, "08:00"), creatorId: U_BA, assigneeId: U_BA,
    isShared: true, tags: ["xe cộ", "giấy tờ"], rewardPoints: 0,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-2), updatedAt: ts(-2),
  },
  // ── Việc nhà chung
  {
    id: id("task"), title: "Dọn nhà cuối tuần",
    description: "Phân công: Ba lau nhà, Mẹ bếp, Bin gấp quần áo, Na nhặt đồ chơi.",
    status: TaskStatus.TODO, priority: TaskPriority.MEDIUM,
    dueDate: dt(5, "09:00"), creatorId: U_ME, assigneeId: null,
    isShared: true, tags: ["nhà cửa"], rewardPoints: 20,
    completedById: null, completedAt: null,
    recurrenceType: "weekly", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-7), updatedAt: ts(-7),
  },
  {
    id: id("task"), title: "Đặt vé du lịch Đà Lạt",
    description: "Dự kiến nghỉ lễ 2/9, cần đặt trước 1 tháng. Check Traveloka và Bamboo Airways.",
    status: TaskStatus.TODO, priority: TaskPriority.MEDIUM,
    dueDate: dt(15, "20:00"), creatorId: U_BA, assigneeId: U_BA,
    isShared: false, tags: ["du lịch"], rewardPoints: 0,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-1), updatedAt: ts(-1),
  },
  {
    id: id("task"), title: "Đặt lịch tiêm nhắc cho Bé Na",
    description: "Na cần tiêm Sởi-Quai bị-Rubella mũi 2 trước tháng 9.",
    status: TaskStatus.TODO, priority: TaskPriority.HIGH,
    dueDate: dt(30, "10:00"), creatorId: U_ME, assigneeId: U_ME,
    isShared: false, tags: ["sức khỏe"], rewardPoints: 0,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(0), updatedAt: ts(0),
  },
  // ── Task cho trẻ em (kiếm điểm)
  {
    id: id("task"), title: "Bin: tự đánh răng buổi tối 7 ngày liên tiếp",
    description: "Ba mẹ sẽ check mỗi tối. Hoàn thành → 30 điểm.",
    status: TaskStatus.IN_PROGRESS, priority: TaskPriority.LOW,
    dueDate: dt(7, "21:00"), creatorId: U_ME, assigneeId: U_BIN,
    isShared: false, tags: ["thói quen"], rewardPoints: 30,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-2), updatedAt: ts(-2),
  },
  {
    id: id("task"), title: "Na: tự thu dọn đồ chơi trước khi ngủ",
    description: "Mỗi tối trước 9h. Hoàn thành tuần này → 20 điểm.",
    status: TaskStatus.TODO, priority: TaskPriority.LOW,
    dueDate: dt(7, "21:00"), creatorId: U_ME, assigneeId: U_NA,
    isShared: false, tags: ["thói quen"], rewardPoints: 20,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-1), updatedAt: ts(-1),
  },
  // ── Quá hạn
  {
    id: id("task"), title: "Gia hạn bảo hiểm nhân thọ",
    description: "Liên hệ anh Hùng Prudential số 0903...",
    status: TaskStatus.OVERDUE, priority: TaskPriority.HIGH,
    dueDate: dt(-3, "17:00"), creatorId: U_BA, assigneeId: U_BA,
    isShared: false, tags: ["tài chính", "giấy tờ"], rewardPoints: 0,
    completedById: null, completedAt: null,
    recurrenceType: "none", recurrenceInterval: 1, sourceRecurringTaskId: null,
    comments: [], history: [], createdAt: ts(-10), updatedAt: ts(-3),
  },
];

// ─── 3. PLANS ─────────────────────────────────────────────────────────────────

const plans: FamilyOrganizerDB["plans"] = [
  // Quá khứ
  {
    id: id("plan"), title: "Sinh nhật Ba — tổ chức tại nhà",
    description: "Mời ông bà nội, ngoại. Đặt bánh gato ở Brodard.",
    startDate: `${day(-127)} 18:00`, endDate: `${day(-127)} 22:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_ME, isShared: true, color: "rose",
    createdAt: ts(-140),
  },
  {
    id: id("plan"), title: "Tổng kết năm học — trường Bin",
    description: "Nhận học bạ và phần thưởng học sinh giỏi.",
    startDate: `${day(-20)} 08:00`, endDate: `${day(-20)} 11:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_ME, isShared: true, color: "amber",
    createdAt: ts(-25),
  },
  // Sắp tới
  {
    id: id("plan"), title: "Sinh nhật Mẹ 🎂",
    description: "Surprize! Đặt bánh fondant hình mèo. Ba và Bin Na đã chuẩn bị.",
    startDate: `${day(2)} 18:00`, endDate: `${day(2)} 21:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_BA, isShared: true, color: "rose",
    createdAt: ts(-7),
  },
  {
    id: id("plan"), title: "Khám sức khoẻ định kỳ cả nhà",
    description: "Đã đặt lịch tại BV Gia Đình lúc 8h sáng. Nhịn ăn từ 10h đêm hôm trước.",
    startDate: `${day(10)} 08:00`, endDate: `${day(10)} 12:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_BA, isShared: true, color: "sky",
    createdAt: ts(-5),
  },
  {
    id: id("plan"), title: "Du lịch Đà Lạt — nghỉ lễ 2/9",
    description: "Dự kiến 4 ngày 3 đêm. Thuê xe tự lái hoặc xe limousine. Check khách sạn Ana Mandara.",
    startDate: `${day(44)} 06:00`, endDate: `${day(47)} 20:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_BA, isShared: true, color: "emerald",
    createdAt: ts(-3),
  },
  {
    id: id("plan"), title: "Họp phụ huynh đầu năm — trường Na",
    description: "Họp lớp Lá chuẩn bị năm học mới. Phụ huynh cần đem theo sổ tiêm chủng.",
    startDate: `${day(52)} 16:00`, endDate: `${day(52)} 17:30`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_ME, isShared: false, color: "amber",
    createdAt: ts(-1),
  },
  {
    id: id("plan"), title: "Đăng kiểm xe ô tô",
    description: "Trạm đăng kiểm đường Lê Văn Việt. Mang theo đăng ký xe bản gốc.",
    startDate: `${day(57)} 08:00`, endDate: `${day(57)} 11:00`,
    isRecurring: false, recurrenceType: "none",
    creatorId: U_BA, isShared: false, color: "violet",
    createdAt: ts(-2),
  },
];

// ─── 4. NOTES ─────────────────────────────────────────────────────────────────

const notes: FamilyOrganizerDB["notes"] = [
  {
    id: id("note"), title: "📶 Wifi & mật khẩu nhà",
    content: `## Thông tin mạng gia đình\n\n| Mạng | Mật khẩu |\n|---|---|\n| **HOME_5G** | gia@dinh2024 |\n| **HOME_2.4G** | gia@dinh2024 |\n\n> Nhớ đổi mật khẩu định kỳ 6 tháng/lần.\n\n### Camera an ninh\n- App: **Ezviz** — tài khoản: ba@gmail.com\n- Camera phòng khách + cửa trước`,
    isPinned: true, creatorId: U_BA,
    tags: ["nhà cửa", "wifi"],
    isShared: true, allowedRolesToEdit: [UserRole.ADMIN, UserRole.MEMBER],
    createdAt: ts(-60), updatedAt: ts(-60),
  },
  {
    id: id("note"), title: "📋 Quy tắc gia đình",
    content: `# Nội quy nhà Nguyễn\n\n## Buổi sáng\n- Thức dậy trước 6:30\n- Tự dọn giường\n- Ăn sáng cùng nhau\n\n## Màn hình & thiết bị\n- Bin: tối đa **60 phút/ngày** (sau 5h chiều)\n- Na: tối đa **45 phút/ngày**\n- Không điện thoại trong bữa ăn\n\n## Phân công việc nhà\n| Việc | Người phụ trách |\n|---|---|\n| Đổ rác | Ba (sáng T2, T5) |\n| Lau nhà | Mẹ (cuối tuần) |\n| Rửa bát | Mẹ buổi sáng, Ba buổi tối |\n| Gấp quần áo | Bin |\n\n> *Cả nhà thực hiện → cuối tuần cùng ra ăn kem* 🍦`,
    isPinned: true, creatorId: U_ME,
    tags: ["gia đình"],
    isShared: true, allowedRolesToEdit: [UserRole.ADMIN, UserRole.MEMBER],
    createdAt: ts(-90), updatedAt: ts(-15),
  },
  {
    id: id("note"), title: "💊 Thuốc & liều dùng trong nhà",
    content: `## Tủ thuốc gia đình\n\n### Ba\n- **Amlor 5mg** (huyết áp) — 1 viên/ngày, uống buổi sáng\n- **Atorvastatin 10mg** (mỡ máu) — 1 viên tối trước ngủ\n\n### Bin & Na (khi cần)\n- **Paracetamol 250mg** — theo cân nặng, tối đa 4 lần/ngày\n- **Dung dịch oresol** — pha 1 gói với 200ml nước ấm\n\n⚠️ Dị ứng của Bin: **hải sản** — có thể nổi mề đay`,
    isPinned: false, creatorId: U_ME,
    tags: ["sức khỏe", "thuốc"],
    isShared: true, allowedRolesToEdit: [UserRole.ADMIN, UserRole.MEMBER],
    createdAt: ts(-30), updatedAt: ts(-5),
  },
  {
    id: id("note"), title: "🏦 Tài khoản ngân hàng gia đình",
    content: `## Danh sách tài khoản\n\n| Ngân hàng | Số tài khoản | Chủ tài khoản | Ghi chú |\n|---|---|---|---|\n| Vietcombank | 103xxxxxxx | Nguyễn Văn Minh | Lương Ba, thanh toán chính |\n| Techcombank | 191xxxxxxx | Trần Thị Thu | Lương Mẹ |\n| BIDV | 318xxxxxxx | Nguyễn Văn Minh | Tiết kiệm |\n\n### Ví điện tử\n- **Momo**: 0901234567 (Ba)\n- **ZaloPay**: 0912345678 (Mẹ)`,
    isPinned: false, creatorId: U_BA,
    tags: ["tài chính"],
    isShared: false, allowedRolesToEdit: [UserRole.ADMIN],
    createdAt: ts(-45), updatedAt: ts(-45),
  },
  {
    id: id("note"), title: "🍰 Công thức bánh bông lan cơ bản",
    content: `## Nguyên liệu (1 khuôn 20cm)\n\n- 3 trứng gà\n- 100g bột mì\n- 80g đường\n- 60g bơ nhạt\n- 1 muỗng cà phê baking powder\n- 1/4 muỗng muối\n- 1 muỗng vani\n\n## Cách làm\n1. Tách lòng trắng và lòng đỏ trứng\n2. Đánh bơ + đường đến bông xốp (~5 phút)\n3. Cho lòng đỏ vào từng cái, đánh tiếp\n4. Rây bột + baking powder + muối vào\n5. Đánh lòng trắng bông cứng, fold vào hỗn hợp\n6. Nướng 170°C trong 30–35 phút\n\n> Tip: cho khăn ướt quanh khuôn để bánh không nứt mặt 🎂`,
    isPinned: false, creatorId: U_ME,
    tags: ["nấu ăn"],
    isShared: false, allowedRolesToEdit: [UserRole.ADMIN, UserRole.MEMBER],
    createdAt: ts(-20), updatedAt: ts(-20),
  },
];

// ─── 5. FINANCE: TRANSACTIONS ─────────────────────────────────────────────────

// ~60 giao dịch trải đều 3 tháng để dashboard/biểu đồ có dữ liệu đẹp
const transactions: FamilyOrganizerDB["transactions"] = [
  // Lương tháng 5 & 6 & 7
  { id: id("tx"), type: TransactionType.INCOME, amount: 25_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 5 — Ba", date: day(-75), creatorId: U_BA, createdAt: ts(-75) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 18_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 5 — Mẹ", date: day(-75), creatorId: U_ME, createdAt: ts(-75) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 25_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 6 — Ba", date: day(-45), creatorId: U_BA, createdAt: ts(-45) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 18_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 6 — Mẹ", date: day(-45), creatorId: U_ME, createdAt: ts(-45) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 5_000_000, category: "bonus", account: AccountType.BANK, description: "Thưởng quý 2 — Ba", date: day(-42), creatorId: U_BA, createdAt: ts(-42) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 25_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 7 — Ba", date: day(-10), creatorId: U_BA, createdAt: ts(-10) },
  { id: id("tx"), type: TransactionType.INCOME, amount: 18_000_000, category: "salary", account: AccountType.BANK, description: "Lương tháng 7 — Mẹ", date: day(-10), creatorId: U_ME, createdAt: ts(-10) },

  // Chi tiêu tháng 5
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 4_200_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ + siêu thị tuần 1 tháng 5", date: day(-78), creatorId: U_ME, createdAt: ts(-78) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 3_800_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 2 tháng 5", date: day(-71), creatorId: U_ME, createdAt: ts(-71) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 4_100_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 3 + đặt đồ ăn online", date: day(-64), creatorId: U_ME, createdAt: ts(-64) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 3_950_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 4 tháng 5", date: day(-57), creatorId: U_ME, createdAt: ts(-57) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 1_350_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền điện tháng 5", date: day(-70), creatorId: U_BA, createdAt: ts(-70) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 240_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền nước tháng 5", date: day(-68), creatorId: U_BA, createdAt: ts(-68) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 280_000, category: "internet", account: AccountType.BANK, description: "Internet VNPT tháng 5", date: day(-65), creatorId: U_BA, createdAt: ts(-65) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 5_600_000, category: ExpenseCategory.EDUCATION, account: AccountType.BANK, description: "Học phí tháng 5 — Bin + Na", date: day(-73), creatorId: U_ME, createdAt: ts(-73) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 850_000, category: ExpenseCategory.TRANSPORT, account: AccountType.CASH, description: "Xăng xe tháng 5", date: day(-60), creatorId: U_BA, createdAt: ts(-60) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 2_300_000, category: ExpenseCategory.SHOPPING, account: AccountType.BANK, description: "Mua quần áo hè cho Bin Na", date: day(-62), creatorId: U_ME, createdAt: ts(-62) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 650_000, category: ExpenseCategory.MEDICAL, account: AccountType.CASH, description: "Khám và mua thuốc cho Ba", date: day(-66), creatorId: U_BA, createdAt: ts(-66) },

  // Chi tiêu tháng 6
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 4_350_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 1 tháng 6", date: day(-48), creatorId: U_ME, createdAt: ts(-48) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 3_700_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 2 tháng 6", date: day(-41), creatorId: U_ME, createdAt: ts(-41) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 5_200_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ + tiệc sinh nhật Ba", date: day(-34), creatorId: U_ME, createdAt: ts(-34) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 4_050_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 4 tháng 6", date: day(-27), creatorId: U_ME, createdAt: ts(-27) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 1_480_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền điện tháng 6", date: day(-40), creatorId: U_BA, createdAt: ts(-40) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 255_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền nước tháng 6", date: day(-38), creatorId: U_BA, createdAt: ts(-38) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 280_000, category: "internet", account: AccountType.BANK, description: "Internet VNPT tháng 6", date: day(-35), creatorId: U_BA, createdAt: ts(-35) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 5_600_000, category: ExpenseCategory.EDUCATION, account: AccountType.BANK, description: "Học phí tháng 6 — Bin + Na", date: day(-43), creatorId: U_ME, createdAt: ts(-43) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 3_200_000, category: ExpenseCategory.CEREMONY, account: AccountType.CASH, description: "Mừng đám cưới bạn của Ba", date: day(-35), creatorId: U_BA, createdAt: ts(-35) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 780_000, category: ExpenseCategory.TRANSPORT, account: AccountType.CASH, description: "Xăng + phí gửi xe tháng 6", date: day(-30), creatorId: U_BA, createdAt: ts(-30) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 1_800_000, category: ExpenseCategory.MEDICAL, account: AccountType.BANK, description: "Tiêm vaccine cho Bin + Na", date: day(-28), creatorId: U_ME, createdAt: ts(-28) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 450_000, category: "insurance", account: AccountType.BANK, description: "Phí bảo hiểm xe tháng 6", date: day(-44), creatorId: U_BA, createdAt: ts(-44) },

  // Chi tiêu tháng 7 (đến nay)
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 4_100_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 1 tháng 7", date: day(-18), creatorId: U_ME, createdAt: ts(-18) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 3_650_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ + Grab Food tuần 2", date: day(-11), creatorId: U_ME, createdAt: ts(-11) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 2_900_000, category: ExpenseCategory.FOOD, account: AccountType.CASH, description: "Chợ tuần 3 tháng 7", date: day(-4), creatorId: U_ME, createdAt: ts(-4) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 1_120_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền điện tháng 7", date: day(-12), creatorId: U_BA, createdAt: ts(-12) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 230_000, category: ExpenseCategory.UTILITIES, account: AccountType.BANK, description: "Tiền nước tháng 7", date: day(-10), creatorId: U_BA, createdAt: ts(-10) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 280_000, category: "internet", account: AccountType.BANK, description: "Internet VNPT tháng 7", date: day(-8), creatorId: U_BA, createdAt: ts(-8) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 5_600_000, category: ExpenseCategory.EDUCATION, account: AccountType.BANK, description: "Học phí tháng 7 — Bin + Na", date: day(-15), creatorId: U_ME, createdAt: ts(-15) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 920_000, category: ExpenseCategory.TRANSPORT, account: AccountType.CASH, description: "Xăng + bảo dưỡng xe máy", date: day(-6), creatorId: U_BA, createdAt: ts(-6) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 1_200_000, category: ExpenseCategory.SHOPPING, account: AccountType.BANK, description: "Mua đồ dùng học tập chuẩn bị năm học", date: day(-3), creatorId: U_ME, createdAt: ts(-3) },
  { id: id("tx"), type: TransactionType.EXPENSE, amount: 350_000, category: ExpenseCategory.MEDICAL, account: AccountType.CASH, description: "Mua thuốc huyết áp cho Ba", date: day(-7), creatorId: U_ME, createdAt: ts(-7) },
];

// ─── 6. ASSETS ────────────────────────────────────────────────────────────────

const assets: FamilyOrganizerDB["assets"] = [
  {
    id: id("asset"), type: "vehicle", name: "Honda CR-V 2022",
    ownerId: U_BA, quantity: 1, unit: "chiếc",
    estimatedValue: 1_050_000_000, purchaseValue: 1_100_000_000,
    currency: "VND", purchaseDate: "2022-06-15",
    brand: "Honda", serialNo: "51K-123.45",
    notes: "Màu đen, bảo dưỡng định kỳ 6 tháng/lần",
    photos: [], createdById: U_BA, createdAt: ts(-180), updatedAt: ts(-30),
  },
  {
    id: id("asset"), type: "gold_bar", name: "Vàng miếng SJC 1 lượng",
    ownerId: U_BA, quantity: 2, unit: "lượng",
    estimatedValue: 0, // Tính tự động theo giá live
    purchaseValue: 75_000_000, currency: "VND",
    purchaseDate: "2023-01-10",
    goldPurity: "9999", weight: 2, weightUnit: "lượng",
    notes: "Cất két sắt tại nhà",
    photos: [], createdById: U_BA, createdAt: ts(-180), updatedAt: ts(-1),
  },
  {
    id: id("asset"), type: "crypto", name: "Bitcoin",
    ownerId: U_BA, quantity: 0.15, unit: "BTC",
    estimatedValue: 0, // Tính tự động theo giá live
    purchaseValue: 9_000_000, currency: "USD",
    purchaseDate: "2021-11-20",
    symbol: "BTC", network: "Bitcoin",
    walletLabel: "Ledger Nano X",
    walletAddressMasked: "bc1q...x7f2",
    photos: [], createdById: U_BA, createdAt: ts(-150), updatedAt: ts(-1),
  },
  {
    id: id("asset"), type: "land", name: "Nhà + đất HCM (đang ở)",
    ownerId: U_BA, quantity: 1, unit: "căn",
    estimatedValue: 4_500_000_000, purchaseValue: 3_200_000_000,
    currency: "VND", purchaseDate: "2019-03-10",
    address: "TP. Hồ Chí Minh",
    areaM2: 72,
    certificateNo: "CH-00123",
    photos: [], createdById: U_BA, createdAt: ts(-180), updatedAt: ts(-60),
  },
];

// ─── 7. BUDGETS ───────────────────────────────────────────────────────────────

const currentMonth = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;
const lastMonth = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

const budgets: FamilyOrganizerDB["budgets"] = [
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.FOOD, limit: 16_000_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.UTILITIES, limit: 2_500_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.EDUCATION, limit: 6_000_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.SHOPPING, limit: 3_000_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.MEDICAL, limit: 1_500_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: currentMonth, category: ExpenseCategory.TRANSPORT, limit: 1_200_000, createdAt: ts(-30), updatedAt: ts(-30) },
  { id: id("budget"), month: lastMonthStr, category: ExpenseCategory.FOOD, limit: 16_000_000, createdAt: ts(-60), updatedAt: ts(-60) },
  { id: id("budget"), month: lastMonthStr, category: ExpenseCategory.UTILITIES, limit: 2_500_000, createdAt: ts(-60), updatedAt: ts(-60) },
  { id: id("budget"), month: lastMonthStr, category: ExpenseCategory.EDUCATION, limit: 6_000_000, createdAt: ts(-60), updatedAt: ts(-60) },
];

// ─── 8. RECURRING BILLS ───────────────────────────────────────────────────────

const recurringBills: FamilyOrganizerDB["recurringBills"] = [
  {
    id: id("bill"), title: "Tiền điện EVN",
    amount: 1_300_000, category: ExpenseCategory.UTILITIES,
    account: AccountType.BANK, frequency: "monthly",
    nextDueDate: day(10), isActive: true,
    lastPaidDate: day(-20),
    notes: "Thanh toán qua app ViettelPay hoặc VCB",
    createdAt: ts(-90), updatedAt: ts(-20),
  },
  {
    id: id("bill"), title: "Internet VNPT",
    amount: 280_000, category: "internet",
    account: AccountType.BANK, frequency: "monthly",
    nextDueDate: day(12), isActive: true,
    lastPaidDate: day(-18),
    createdAt: ts(-90), updatedAt: ts(-18),
  },
  {
    id: id("bill"), title: "Học phí Bin + Na",
    amount: 5_600_000, category: ExpenseCategory.EDUCATION,
    account: AccountType.BANK, frequency: "monthly",
    nextDueDate: day(5), isActive: true,
    lastPaidDate: day(-25),
    notes: "Chuyển khoản STK trường trước ngày 10",
    createdAt: ts(-90), updatedAt: ts(-25),
  },
  {
    id: id("bill"), title: "Bảo hiểm nhân thọ Prudential",
    amount: 6_000_000, category: "insurance",
    account: AccountType.BANK, frequency: "yearly",
    nextDueDate: day(170), isActive: true,
    lastPaidDate: day(-195),
    notes: "Liên hệ anh Hùng trước 1 tháng để gia hạn",
    createdAt: ts(-200), updatedAt: ts(-200),
  },
];

// ─── 9. SAVINGS GOALS ─────────────────────────────────────────────────────────

const goingId  = id("goal");
const renovId  = id("goal");

const savingsGoals: FamilyOrganizerDB["savingsGoals"] = [
  {
    id: goingId, name: "Quỹ du lịch Đà Lạt 9/2026",
    targetAmount: 20_000_000, deadline: day(44),
    color: "emerald", isShared: true, creatorId: U_BA,
    note: "Du lịch 4 ngày 3 đêm, 4 người. Bao gồm vé, khách sạn, ăn uống.",
    contributions: [
      { id: id("sc"), amount: 5_000_000, date: day(-60), note: "Bắt đầu tích lũy", byId: U_BA, createdAt: ts(-60) },
      { id: id("sc"), amount: 3_000_000, date: day(-30), byId: U_ME, createdAt: ts(-30) },
      { id: id("sc"), amount: 3_000_000, date: day(-5),  byId: U_BA, createdAt: ts(-5) },
    ],
    createdAt: ts(-60), updatedAt: ts(-5),
  },
  {
    id: renovId, name: "Quỹ sơn sửa nhà 2027",
    targetAmount: 80_000_000, deadline: `${NOW.getFullYear() + 1}-03-01`,
    color: "amber", isShared: true, creatorId: U_BA,
    note: "Sơn lại toàn bộ nội thất, thay gạch phòng tắm.",
    contributions: [
      { id: id("sc"), amount: 10_000_000, date: day(-90), byId: U_BA, createdAt: ts(-90) },
      { id: id("sc"), amount: 5_000_000,  date: day(-60), byId: U_ME, createdAt: ts(-60) },
      { id: id("sc"), amount: 5_000_000,  date: day(-30), byId: U_BA, createdAt: ts(-30) },
    ],
    createdAt: ts(-90), updatedAt: ts(-30),
  },
];

// ─── 10. DEBTS ────────────────────────────────────────────────────────────────

const debts: FamilyOrganizerDB["debts"] = [
  {
    id: id("debt"), direction: "borrowed",
    counterparty: "Ngân hàng Techcombank",
    amount: 150_000_000, loanDate: "2021-06-01",
    dueDate: "2028-06-01",
    bankName: "Techcombank — vay mua xe",
    isSettled: false, creatorId: U_BA,
    note: "Vay mua xe Honda CR-V, trả góp 7 năm. Còn ~100 triệu.",
    payments: [
      { id: id("dp"), amount: 2_200_000, date: day(-60), note: "Kỳ tháng 5", byId: U_BA, createdAt: ts(-60) },
      { id: id("dp"), amount: 2_200_000, date: day(-30), note: "Kỳ tháng 6", byId: U_BA, createdAt: ts(-30) },
      { id: id("dp"), amount: 2_200_000, date: day(-1),  note: "Kỳ tháng 7", byId: U_BA, createdAt: ts(-1) },
    ],
    createdAt: ts(-180), updatedAt: ts(-1),
  },
  {
    id: id("debt"), direction: "lent",
    counterparty: "Anh Tuấn (đồng nghiệp)",
    phone: "0934567890",
    amount: 5_000_000, loanDate: day(-45),
    dueDate: day(15),
    isSettled: false, creatorId: U_BA,
    note: "Cho mượn để đóng học phí con. Hẹn trả cuối tháng 7.",
    payments: [],
    createdAt: ts(-45), updatedAt: ts(-45),
  },
];

// ─── 11. MEDICATIONS ──────────────────────────────────────────────────────────

const medHuyetAp = id("med");
const medVitaminD = id("med");

const medications: FamilyOrganizerDB["medications"] = [
  {
    id: medHuyetAp, name: "Amlor 5mg (huyết áp)",
    dosage: "1 viên", patientId: U_BA,
    times: ["07:00"], startDate: day(-180),
    isActive: true,
    notes: "Uống sau ăn sáng. Tái khám mỗi 3 tháng.",
    createdAt: ts(-180), updatedAt: ts(-180),
  },
  {
    id: medVitaminD, name: "Vitamin D3 1000IU",
    dosage: "1 viên", patientId: U_BIN,
    times: ["07:30"], startDate: day(-60), endDate: day(30),
    isActive: true,
    notes: "Uống khi ăn sáng. Bác sĩ kê cho thiếu D3.",
    createdAt: ts(-60), updatedAt: ts(-60),
  },
];

// ─── 12. GROWTH RECORDS ───────────────────────────────────────────────────────

// Bin (9 tuổi): cao 133cm, nặng 28kg. 12 điểm đo theo tháng.
const growthBin = Array.from({ length: 12 }, (_, i) => ({
  id: id("gr"),
  childId: U_BIN,
  date: day(-(11 - i) * 30),
  heightCm: 124 + i * 0.75,
  weightKg: parseFloat((25.5 + i * 0.2).toFixed(1)),
  createdAt: ts(-(11 - i) * 30),
}));

// Na (6 tuổi): cao 112cm, nặng 18kg.
const growthNa = Array.from({ length: 12 }, (_, i) => ({
  id: id("gr"),
  childId: U_NA,
  date: day(-(11 - i) * 30),
  heightCm: 103 + i * 0.75,
  weightKg: parseFloat((15.5 + i * 0.2).toFixed(1)),
  createdAt: ts(-(11 - i) * 30),
}));

const growthRecords: FamilyOrganizerDB["growthRecords"] = [...growthBin, ...growthNa];

// ─── 13. VACCINATIONS ─────────────────────────────────────────────────────────

const vaccinations: FamilyOrganizerDB["vaccinations"] = [
  // Bin
  { id: id("vac"), childId: U_BIN, name: "Sởi - Quai bị - Rubella (MMR)", doseLabel: "Mũi 1", doneDate: "2019-02-10", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_BIN, name: "Thương hàn", doseLabel: "Mũi 1", doneDate: "2021-05-18", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_BIN, name: "Viêm gan A", doseLabel: "Mũi 1", doneDate: "2022-03-07", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_BIN, name: "Viêm gan A", doseLabel: "Mũi 2", doneDate: "2022-09-07", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_BIN, name: "HPV (Gardasil 9)", doseLabel: "Mũi 1", scheduledDate: day(45), status: "scheduled", note: "Tiêm tại VNVC trước tháng 9", createdAt: ts(-5), updatedAt: ts(-5) },
  // Na
  { id: id("vac"), childId: U_NA, name: "Sởi - Quai bị - Rubella (MMR)", doseLabel: "Mũi 1", doneDate: "2021-10-15", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_NA, name: "Thủy đậu", doseLabel: "Mũi 1", doneDate: "2021-12-05", status: "done", createdAt: ts(-200), updatedAt: ts(-200) },
  { id: id("vac"), childId: U_NA, name: "Sởi - Quai bị - Rubella (MMR)", doseLabel: "Mũi 2 (nhắc lại)", scheduledDate: day(55), status: "scheduled", note: "Trễ hẹn, cần đặt lịch sớm", createdAt: ts(-10), updatedAt: ts(-10) },
];

// ─── 14. HEALTH PROFILES ─────────────────────────────────────────────────────

const healthProfiles: FamilyOrganizerDB["healthProfiles"] = [
  {
    id: `hp_${U_BA}`, userId: U_BA,
    bloodType: "A+",
    chronicConditions: "Huyết áp cao (đang điều trị), mỡ máu nhẹ",
    currentMedications: "Amlor 5mg mỗi sáng, Atorvastatin 10mg mỗi tối",
    healthInsuranceNumber: "DN4510123456789",
    emergencyContacts: [
      { name: "Trần Thị Thu (vợ)", phone: "0912345678", relation: "Vợ" },
      { name: "BS Lê Văn Hùng", phone: "0938765432", relation: "Bác sĩ gia đình" },
    ],
    createdAt: ts(-90), updatedAt: ts(-7),
  },
  {
    id: `hp_${U_ME}`, userId: U_ME,
    bloodType: "O+",
    healthInsuranceNumber: "DN4521234567890",
    emergencyContacts: [
      { name: "Nguyễn Văn Minh (chồng)", phone: "0901234567", relation: "Chồng" },
    ],
    createdAt: ts(-90), updatedAt: ts(-90),
  },
  {
    id: `hp_${U_BIN}`, userId: U_BIN,
    bloodType: "A+",
    allergies: "Hải sản (tôm, cua) — nổi mề đay",
    healthInsuranceNumber: "DN4534567890123",
    emergencyContacts: [
      { name: "Nguyễn Văn Minh (ba)", phone: "0901234567", relation: "Ba" },
      { name: "Trần Thị Thu (mẹ)", phone: "0912345678", relation: "Mẹ" },
    ],
    createdAt: ts(-90), updatedAt: ts(-90),
  },
  {
    id: `hp_${U_NA}`, userId: U_NA,
    bloodType: "O+",
    healthInsuranceNumber: "DN4545678901234",
    emergencyContacts: [
      { name: "Nguyễn Văn Minh (ba)", phone: "0901234567", relation: "Ba" },
      { name: "Trần Thị Thu (mẹ)", phone: "0912345678", relation: "Mẹ" },
    ],
    createdAt: ts(-90), updatedAt: ts(-90),
  },
];

// ─── 15. DOCUMENTS ────────────────────────────────────────────────────────────

const documents: FamilyOrganizerDB["documents"] = [
  // Ba
  {
    id: id("doc"), type: "cccd", title: "CCCD — Nguyễn Văn Minh",
    ownerId: U_BA, documentNumber: "079085012345",
    issuer: "Cục Cảnh sát QLHC về TTXH",
    issueDate: "2021-06-20", expiryDate: "2031-06-20",
    isShared: false, creatorId: U_BA, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  {
    id: id("doc"), type: "driver_license", title: "Bằng lái xe B2 — Ba",
    ownerId: U_BA, documentNumber: "0790851234567",
    issuer: "Sở GTVT TP.HCM",
    issueDate: "2014-03-10",
    isShared: false, creatorId: U_BA, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  {
    id: id("doc"), type: "vehicle_registration", title: "Đăng ký xe Honda CR-V",
    ownerId: U_BA, documentNumber: "51K-12345",
    issuer: "Phòng CSGT TP.HCM",
    issueDate: "2022-07-01",
    isShared: false, creatorId: U_BA, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  {
    id: id("doc"), type: "vehicle_inspection", title: "Đăng kiểm xe CR-V",
    ownerId: U_BA,
    issueDate: "2024-09-15",
    expiryDate: day(57), // sắp hết hạn — sẽ hiện cảnh báo
    isShared: false, creatorId: U_BA, files: [],
    createdAt: ts(-300), updatedAt: ts(-300),
  },
  // Mẹ
  {
    id: id("doc"), type: "cccd", title: "CCCD — Trần Thị Thu",
    ownerId: U_ME, documentNumber: "079087654321",
    issuer: "Cục Cảnh sát QLHC về TTXH",
    issueDate: "2021-08-15", expiryDate: "2031-08-15",
    isShared: false, creatorId: U_ME, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  {
    id: id("doc"), type: "passport", title: "Hộ chiếu — Mẹ",
    ownerId: U_ME, documentNumber: "B1234567",
    issuer: "Cục Quản lý xuất nhập cảnh",
    issueDate: "2019-11-10",
    expiryDate: day(110), // còn ~4 tháng — cảnh báo sắp hết
    isShared: false, creatorId: U_ME, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  // Bảo hiểm gia đình
  {
    id: id("doc"), type: "health_insurance", title: "BHYT — Nguyễn Văn Minh",
    ownerId: U_BA, documentNumber: "DN4510123456789",
    issuer: "BHXH TP.HCM",
    expiryDate: `${NOW.getFullYear()}-12-31`,
    isShared: false, creatorId: U_BA, files: [],
    createdAt: ts(-150), updatedAt: ts(-150),
  },
  {
    id: id("doc"), type: "insurance", title: "Bảo hiểm nhân thọ Prudential — Ba",
    ownerId: U_BA,
    issueDate: "2019-01-10", expiryDate: day(170),
    isShared: true, creatorId: U_BA, files: [],
    notes: "Gói PRUlink Assurance Account. Phí 6 triệu/năm.",
    createdAt: ts(-200), updatedAt: ts(-200),
  },
];

// ─── 16. SHOPPING ITEMS ───────────────────────────────────────────────────────

const shoppingItems: FamilyOrganizerDB["shoppingItems"] = [
  { id: id("shop"), name: "Rau muống", quantity: "2 bó", isPurchased: false, creatorId: U_ME, createdAt: ts(-1), updatedAt: ts(-1) },
  { id: id("shop"), name: "Thịt bò bắp", quantity: "500g", isPurchased: false, creatorId: U_ME, createdAt: ts(-1), updatedAt: ts(-1) },
  { id: id("shop"), name: "Sữa TH True Milk (1L)", quantity: "4 hộp", isPurchased: false, creatorId: U_ME, createdAt: ts(-1), updatedAt: ts(-1) },
  { id: id("shop"), name: "Trứng gà ta", quantity: "1 vỉ 10 quả", isPurchased: true, creatorId: U_BA, purchasedById: U_BA, createdAt: ts(-2), updatedAt: ts(-1) },
  { id: id("shop"), name: "Nước mắm Phú Quốc", quantity: "1 chai 500ml", isPurchased: false, creatorId: U_ME, createdAt: ts(0), updatedAt: ts(0) },
  { id: id("shop"), name: "Sữa chua Vinamilk", quantity: "1 lốc 4 hũ", isPurchased: false, creatorId: U_ME, createdAt: ts(0), updatedAt: ts(0) },
];

// ─── 17. REWARD ITEMS & LEDGER ────────────────────────────────────────────────

const rewardItems: FamilyOrganizerDB["rewardItems"] = [
  { id: id("ri"), name: "30 phút iPad/YouTube", emoji: "📱", cost: 20, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
  { id: id("ri"), name: "Ăn kem 1 cây", emoji: "🍦", cost: 30, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
  { id: id("ri"), name: "Đi công viên nước cuối tuần", emoji: "🌊", cost: 100, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
  { id: id("ri"), name: "Chọn menu bữa tối (1 lần)", emoji: "🍕", cost: 40, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
  { id: id("ri"), name: "Mua đồ chơi dưới 200k", emoji: "🎁", cost: 150, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
  { id: id("ri"), name: "Xem phim rạp cuối tuần", emoji: "🎬", cost: 80, isActive: true, createdAt: ts(-90), updatedAt: ts(-90) },
];

const rewardLedger: FamilyOrganizerDB["rewardLedger"] = [
  // Bin đã tích 150 điểm
  { id: id("rl"), userId: U_BIN, points: 50, reason: "Hoàn thành tự học bài mỗi tối tuần 1", createdById: U_ME, createdAt: ts(-60) },
  { id: id("rl"), userId: U_BIN, points: 30, reason: "Tự dọn phòng 5 ngày liên tiếp", createdById: U_ME, createdAt: ts(-40) },
  { id: id("rl"), userId: U_BIN, points: -30, reason: "Đổi thưởng: Ăn kem 1 cây 🍦", createdById: U_ME, createdAt: ts(-30) },
  { id: id("rl"), userId: U_BIN, points: 50, reason: "Học sinh giỏi cuối năm — thưởng đặc biệt", createdById: U_BA, createdAt: ts(-20) },
  { id: id("rl"), userId: U_BIN, points: 40, reason: "Không cần nhắc đánh răng cả tuần", createdById: U_ME, createdAt: ts(-10) },
  // Na đã tích 80 điểm
  { id: id("rl"), userId: U_NA, points: 30, reason: "Tự mặc quần áo mỗi sáng trong 1 tuần", createdById: U_ME, createdAt: ts(-45) },
  { id: id("rl"), userId: U_NA, points: 20, reason: "Ăn hết rau mỗi bữa trong tuần", createdById: U_ME, createdAt: ts(-30) },
  { id: id("rl"), userId: U_NA, points: 30, reason: "Giúp Mẹ phơi quần áo", createdById: U_ME, createdAt: ts(-15) },
];

// ─── 18. NOTIFICATIONS ────────────────────────────────────────────────────────

const notifications: FamilyOrganizerDB["notifications"] = [
  {
    id: id("notif"), userId: U_BA,
    title: "Sắp đến hạn: Gia hạn bảo hiểm nhân thọ",
    content: "Task 'Gia hạn bảo hiểm nhân thọ' đã quá hạn 3 ngày.",
    type: "task", isRead: false, createdAt: ts(-3),
  },
  {
    id: id("notif"), userId: "all",
    title: "🎂 Sinh nhật Mẹ sắp tới!",
    content: "Sinh nhật của Mẹ Trần Thị Thu còn 2 ngày nữa (22/7).",
    type: "system", isRead: false, createdAt: ts(0),
  },
  {
    id: id("notif"), userId: U_BIN,
    title: "Bạn được giao task mới!",
    content: "Bin: tự đánh răng buổi tối 7 ngày liên tiếp (+30 điểm khi hoàn thành).",
    type: "task", isRead: true, createdAt: ts(-2),
  },
];

// ─── ASSEMBLE & SAVE ──────────────────────────────────────────────────────────

const demoDB: FamilyOrganizerDB = {
  users,
  tasks,
  plans,
  notes,
  transactions,
  rewardLedger,
  rewardItems,
  budgets,
  customCategories: [],
  hiddenBuiltinCategories: [],
  recurringBills,
  savingsGoals,
  debts,
  assets,
  medications,
  medicationLogs: [],
  vaccinations,
  growthRecords,
  healthProfiles,
  documents,
  shoppingItems,
  dishLibrary: [],
  mealPlan: null,
  marketHistory: [],
  notifications,
  pushSubscriptions: [],
  activityLogs: [],
  backups: [],
};

console.log("\n🌱  Family Organizer — Demo Seed");
console.log("━".repeat(40));
console.log(`👥  Users:        ${users.length} (ba / me / bin / na  — mật khẩu: 123456)`);
console.log(`📋  Tasks:        ${tasks.length}`);
console.log(`📅  Plans:        ${plans.length}`);
console.log(`📝  Notes:        ${notes.length}`);
console.log(`💰  Transactions: ${transactions.length}`);
console.log(`🏠  Assets:       ${assets.length}`);
console.log(`💊  Medications:  ${medications.length}`);
console.log(`💉  Vaccinations: ${vaccinations.length}`);
console.log(`📏  Growth logs:  ${growthRecords.length}`);
console.log(`📄  Documents:    ${documents.length}`);
console.log(`🛒  Shopping:     ${shoppingItems.length}`);
console.log(`🎁  Reward items: ${rewardItems.length}`);
console.log("━".repeat(40));
console.log("⚠️   Ghi đè toàn bộ data hiện tại trong data/family.db ...");

sqliteSave(demoDB);

console.log("✅  Xong! Khởi động lại server: npm run dev\n");
