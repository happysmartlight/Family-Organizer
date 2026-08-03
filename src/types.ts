/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// User and Role management
// `role` is the PERMISSION tier (what the account can do).
// `familyRelation` (below) is just a display label for who the person is in the family.
export enum UserRole {
  ADMIN = "admin",   // Toàn quyền (thường là Ba/Mẹ)
  MEMBER = "member", // Người lớn: quản lý nội dung của mình + chi tiêu
  CHILD = "child",   // Con/Trẻ em: tự tạo việc/ghi chú/sự kiện của mình, nhận điểm thưởng, KHÔNG xem chi tiêu
  GUEST = "guest"    // Khách: chỉ xem nội dung được chia sẻ
}

// Family relationship — display label only, does NOT affect permissions.
export type FamilyRelation =
  | "ong_noi" | "ba_noi" | "ong_ngoai" | "ba_ngoai"
  | "ba" | "me" | "con" | "anh_chi_em" | "khach" | "khac";

export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  ong_noi: "Ông nội",
  ba_noi: "Bà nội",
  ong_ngoai: "Ông ngoại",
  ba_ngoai: "Bà ngoại",
  ba: "Ba",
  me: "Mẹ",
  con: "Con",
  anh_chi_em: "Anh/Chị/Em",
  khach: "Khách",
  khac: "Khác"
};

// Human-friendly Vietnamese labels for the permission tier.
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: "Quản lý (Admin)",
  [UserRole.MEMBER]: "Thành viên",
  [UserRole.CHILD]: "Con (Trẻ em)",
  [UserRole.GUEST]: "Khách"
};

// --- Centralized permission policy (shared by client & server) ---
// Adults (Admin/Member) manage finance, medication, awarding rewards.
export const isAdultRole = (role: UserRole) => role === UserRole.ADMIN || role === UserRole.MEMBER;
// Finance & medication modules are hidden from Child and Guest.
export const canAccessFinance = (role: UserRole) => isAdultRole(role);
export const canManageMedication = (role: UserRole) => isAdultRole(role);
// Admin/Member/Child can create their own content; Guest is read-only.
export const canCreateContent = (role: UserRole) => role !== UserRole.GUEST;
// Child & Guest have a restricted view (only shared + their own/assigned items).
export const isLimitedViewer = (role: UserRole) => role === UserRole.CHILD || role === UserRole.GUEST;
// Only Child accounts accumulate reward points.
export const earnsRewardPoints = (role: UserRole) => role === UserRole.CHILD;

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  familyRelation?: FamilyRelation; // Display-only relationship label (Ông/Bà/Ba/Mẹ/Con/Khách...)
  avatarColor: string; // Tailwind color name like 'bg-red-500'
  avatarImage?: string; // Optional custom avatar (base64 data-uri); falls back to avatarColor
  dateOfBirth?: string; // YYYY-MM-DD, used for birthday reminders
  gender?: "male" | "female"; // dùng cho đánh giá BMI theo tuổi/giới (trẻ em)
  phone?: string; // Optional contact phone number
  createdAt: string;
  isDeleted?: boolean; // Soft-delete: giữ lại để resolve tên/avatar trong lịch sử
}

// Session info
export interface UserSession {
  userId: string;
  username: string;
  fullName: string;
  role: UserRole;
}

// Notification system
export interface Notification {
  id: string;
  userId: string; // Recipient (or 'all' for everyone)
  title: string;
  content: string;
  type: "task" | "plan" | "note" | "finance" | "medication" | "system";
  isRead: boolean;
  createdAt: string;
}

export type RecurrenceType = "none" | "daily" | "weekly" | "monthly";

// TasK management
export enum TaskStatus {
  TODO = "todo",          // Chưa làm
  IN_PROGRESS = "in_progress", // Đang làm
  COMPLETED = "completed",   // Hoàn thành
  OVERDUE = "overdue"      // Quá hạn
}

export enum TaskPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high"
}

export interface TaskComment {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
}

export interface TaskHistory {
  id: string;
  userId: string;
  username: string;
  action: string; // e.g. "updated target field status from todo to in_progress"
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string; // YYYY-MM-DD HH:mm
  creatorId: string;
  assigneeId: string | null; // Null means unassigned or shared
  isShared: boolean; // True means shared with everyone in family
  tags: string[];
  rewardPoints?: number;
  completedById?: string | null;
  completedAt?: string | null;
  // Cơ chế duyệt việc có điểm thưởng cho trẻ: trẻ "báo xong" → chờ ba mẹ duyệt
  // mới cộng điểm (task có điểm > ngưỡng tự duyệt của gia đình).
  pendingApproval?: boolean;       // true = trẻ đã báo xong, đang chờ người lớn duyệt
  submittedById?: string | null;   // ai bấm "làm xong"
  submittedAt?: string | null;
  proofImage?: string | null;      // ảnh bằng chứng (data URL) — tùy chọn
  proofNote?: string | null;       // ghi chú kèm khi báo xong — tùy chọn
  rejectionReason?: string | null; // lý do khi bị người lớn trả lại
  recurrenceType?: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceEndDate?: string;
  // Xoay vòng người nhận: mỗi lần task lặp lại tái tạo sẽ chuyển sang thành viên kế tiếp trong danh sách.
  rotationMemberIds?: string[];
  sourceRecurringTaskId?: string | null;
  comments: TaskComment[];
  history: TaskHistory[];
  createdAt: string;
  updatedAt: string;
}

// Plan & Schedule management
export interface FamilyPlan {
  id: string;
  title: string;
  description: string;
  startDate: string; // YYYY-MM-DD HH:mm
  endDate: string; // YYYY-MM-DD HH:mm
  isRecurring: boolean;
  recurrenceType: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceWeekdays?: number[]; // 0=Chủ nhật, 1=Thứ hai...
  creatorId: string;
  isShared: boolean;
  color: string; // e.g. 'emerald', 'sky', 'amber', 'rose'
  createdAt: string;
}

// Note management
export interface Note {
  id: string;
  title: string;
  content: string; // Markdown supported
  isPinned: boolean;
  creatorId: string;
  tags: string[];
  isShared: boolean;
  allowedRolesToEdit: UserRole[]; // Which roles can edit this note
  createdAt: string;
  updatedAt: string;
}

// Financial system
export enum TransactionType {
  INCOME = "income",
  EXPENSE = "expense"
}

export enum ExpenseCategory {
  FOOD = "food",           // Ăn uống
  EDUCATION = "education2", // Học tập / Học phí
  UTILITIES = "utilities", // Điện nước / Gas
  SHOPPING = "shopping",   // Mua sắm
  MEDICAL = "medical",     // Y tế / Sức khỏe
  TRANSPORT = "transport", // Đi lại / Xăng xe
  FUNERAL = "funeral",     // Ma chay
  CEREMONY = "ceremony",   // Hiếu hỉ (đám cưới, sinh nhật, tiệc...)
  OTHER = "other"          // Khác
}

// Hạng mục CHI do NGƯỜI DÙNG tự thêm (Admin quản lý ở Thiết lập → Hệ thống).
// Các hạng mục mặc định của app nằm trong src/utils/expenseCategories.ts và không
// lưu ở DB. transaction.category của hạng mục tự thêm lưu chính `id` bên dưới.
export interface CustomExpenseCategory {
  id: string;        // "cc_<timestamp>"
  label: string;     // tên hiển thị, vd "Thú cưng"
  emoji: string;     // 1 emoji, vd "🐶"
  color: string;     // key màu trong EXPENSE_CAT_COLORS (orange/violet/…)
  createdAt: string;
  updatedAt: string;
}

export enum AccountType {
  CASH = "cash",         // Tiền mặt
  BANK = "bank",         // Ngân hàng
  E_WALLET = "e_wallet"  // Ví điện tử
}

export interface FinancialTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: ExpenseCategory | string;
  account: AccountType;
  description: string;
  date: string; // YYYY-MM-DD
  creatorId: string;
  receiptImage?: string; // Base64 data-uri or image url
  createdAt: string;
}

export interface RewardPointEntry {
  id: string;
  userId: string;
  taskId?: string;
  points: number;
  reason: string;
  createdById: string;
  createdAt: string;
}

// Một món quà trong "cửa hàng đổi thưởng" của trẻ — đổi bằng điểm rewardLedger.
export interface RewardItem {
  id: string;
  name: string;      // "30 phút iPad", "Đi công viên nước"...
  emoji?: string;    // 🎮 🍦 🎡 — hiển thị cho vui mắt
  cost: number;      // số điểm cần để đổi (> 0)
  isActive: boolean; // tắt để ẩn tạm khỏi cửa hàng mà không xóa
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLimit {
  id: string;
  month: string; // YYYY-MM
  category: ExpenseCategory | string;
  limit: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringBill {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory | string;
  account: AccountType;
  frequency: "weekly" | "monthly" | "yearly";
  nextDueDate: string; // YYYY-MM-DD
  notes?: string;
  isActive: boolean;
  lastPaidDate?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Mục tiêu tiết kiệm (sinking fund): để dành cho Tết, du lịch, học phí... ---
export interface SavingsContribution {
  id: string;
  amount: number; // dương = bỏ thêm vào quỹ, âm = rút bớt ra
  date: string;   // YYYY-MM-DD
  note?: string;
  byId: string;   // ai đóng góp
  createdAt: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  deadline?: string;  // YYYY-MM-DD (tùy chọn) — ngày muốn đạt mục tiêu
  color?: string;     // emerald | sky | amber | rose | violet...
  note?: string;
  isShared: boolean;  // chia sẻ cả nhà hay chỉ người tạo
  creatorId: string;
  contributions: SavingsContribution[]; // số dư hiện tại = tổng các đóng góp
  createdAt: string;
  updatedAt: string;
}

// --- Theo dõi vay / cho mượn (nợ) ---
export interface DebtPayment {
  id: string;
  amount: number; // số tiền trả/nhận trong lần này
  date: string;   // YYYY-MM-DD
  note?: string;
  byId: string;
  createdAt: string;
}

export interface Debt {
  id: string;
  direction: "borrowed" | "lent"; // borrowed = mình đang nợ; lent = mình cho mượn
  counterparty: string;           // tên người/tổ chức (bắt buộc)
  address?: string;               // địa chỉ liên hệ
  phone?: string;                 // số điện thoại
  bankName?: string;              // ngân hàng / số tài khoản
  attachments?: string[];         // ảnh giấy tờ vay, biên nhận chuyển khoản... (URL)
  amount: number;                 // tổng nợ gốc
  loanDate?: string;              // YYYY-MM-DD — ngày mượn / cho mượn (bắt đầu)
  dueDate?: string;               // YYYY-MM-DD — ngày hẹn trả (để nhắc)
  note?: string;
  isSettled: boolean;             // đã tất toán
  creatorId: string;
  payments: DebtPayment[];        // còn lại = amount - tổng payments
  createdAt: string;
  updatedAt: string;
}

export type AssetType =
  | "crypto"
  | "land"
  | "gold_bar"
  | "gold_ring"
  | "gold_jewelry"
  | "gold_other"
  | "vehicle"
  | "stock"
  | "other";

export interface AssetPhoto {
  id: string;
  fileName: string;
  thumbnailDataUrl: string;
  fullDataUrl: string;
  width: number;
  height: number;
  sizeKb: number;
  createdAt: string;
}

export interface FamilyAsset {
  id: string;
  type: AssetType;
  name: string;
  ownerId?: string;
  quantity: number;
  unit: string;
  estimatedValue: number;
  purchaseValue?: number;
  currency: "VND" | "USD";
  purchaseDate?: string;
  location?: string;
  notes?: string;
  photos: AssetPhoto[];
  symbol?: string;
  network?: string;
  walletLabel?: string;
  walletAddressMasked?: string;
  address?: string;
  areaM2?: number;
  certificateNo?: string;
  parcelNo?: string;
  goldPurity?: string;
  weight?: number;
  weightUnit?: string;
  brand?: string;
  serialNo?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface MedicationReminder {
  id: string;
  name: string;
  dosage: string;
  patientId: string;
  times: string[]; // HH:mm values
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Nhật ký uống thuốc — một bản ghi cho mỗi liều (medication + ngày + giờ).
// status "taken"/"skipped"; khi người dùng bỏ đánh dấu thì bản ghi bị xoá (về trạng thái chưa ghi nhận).
export interface MedicationLog {
  id: string;
  medicationId: string;
  patientId: string;
  date: string; // YYYY-MM-DD — liều thuộc ngày nào
  time: string; // HH:mm — mốc giờ trong medication.times
  status: "taken" | "skipped";
  loggedById: string; // ai bấm ghi nhận
  loggedAt: string;
  notes?: string;
}

// Shopping / grocery list
export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: string; // free text e.g. "2 kg", "1 hộp"
  note?: string;
  cat?: string; // nhóm chất từ thực đơn (Đạm/Rau củ/…) — gợi ý phân khu quầy khi tên không khớp từ khóa
  isPurchased: boolean;
  creatorId: string;
  purchasedById?: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Kho giấy tờ gia đình (giấy tờ tuỳ thân, đăng kiểm, bảo hiểm, bảo hành...) ---
export type DocumentType =
  | "cccd"                 // CCCD / CMND
  | "passport"             // Hộ chiếu
  | "driver_license"       // Bằng lái xe
  | "vehicle_registration" // Đăng ký xe (cà vẹt)
  | "vehicle_inspection"   // Đăng kiểm xe
  | "insurance"            // Bảo hiểm (xe/nhà/nhân thọ)
  | "health_insurance"     // Bảo hiểm y tế (BHYT)
  | "warranty"             // Bảo hành
  | "contract"             // Hợp đồng
  | "certificate"          // Giấy chứng nhận (khai sinh, kết hôn...)
  | "other";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  cccd: "CCCD / CMND",
  passport: "Hộ chiếu",
  driver_license: "Bằng lái xe",
  vehicle_registration: "Đăng ký xe",
  vehicle_inspection: "Đăng kiểm xe",
  insurance: "Bảo hiểm",
  health_insurance: "Bảo hiểm y tế",
  warranty: "Bảo hành",
  contract: "Hợp đồng",
  certificate: "Giấy chứng nhận",
  other: "Khác"
};

// Một tệp scan/ảnh đính kèm của giấy tờ (lưu dưới dạng URL "/uploads/...").
export interface DocumentFile {
  id: string;
  fileName: string;
  url: string;      // "/uploads/documents/..."
  sizeKb?: number;
  createdAt: string;
}

export interface FamilyDocument {
  id: string;
  type: DocumentType;
  title: string;
  ownerId?: string;        // thuộc về thành viên nào
  documentNumber?: string; // số giấy tờ
  issuer?: string;         // nơi cấp
  issueDate?: string;      // YYYY-MM-DD
  expiryDate?: string;     // YYYY-MM-DD — dùng để nhắc hết hạn
  notes?: string;
  files: DocumentFile[];
  isShared: boolean;       // chia sẻ giữa người lớn hay chỉ người tạo/chủ sở hữu thấy
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

// --- Sức khỏe trẻ em: tiêm chủng & tăng trưởng ---
export interface VaccinationRecord {
  id: string;
  childId: string;        // thành viên (trẻ) được tiêm
  name: string;           // tên vắc-xin
  doseLabel?: string;     // "Mũi 1", "Nhắc lại"...
  scheduledDate?: string; // YYYY-MM-DD — ngày hẹn tiêm (để nhắc)
  doneDate?: string;      // YYYY-MM-DD — ngày đã tiêm
  status: "scheduled" | "done" | "skipped";
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthRecord {
  id: string;
  childId: string;
  date: string;     // YYYY-MM-DD
  heightCm?: number;
  weightKg?: number;
  note?: string;
  createdAt: string;
}

// --- Thẻ khẩn cấp / hồ sơ sức khỏe cơ bản (mỗi thành viên 1 hồ sơ) ---
export const BLOOD_TYPE_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export interface EmergencyContact {
  name: string;
  phone: string;
  relation?: string; // "Bác sĩ gia đình", "Ông nội"...
}

export interface EmergencyProfile {
  id: string;                  // "hp_<userId>" — mỗi thành viên đúng 1 hồ sơ
  userId: string;
  bloodType?: string;          // một trong BLOOD_TYPE_OPTIONS
  allergies?: string;          // dị ứng (thuốc, thức ăn...)
  chronicConditions?: string;  // bệnh nền
  currentMedications?: string; // thuốc đang dùng thường xuyên
  healthInsuranceNumber?: string; // số thẻ BHYT
  emergencyContacts: EmergencyContact[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// A Web Push subscription tied to one user's device/browser. Used to deliver
// system notifications + app-icon badge even when the PWA is closed.
export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string; // unique per device; used as the dedupe / removal key
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  };
  userAgent?: string;
  createdAt: string;
}

// --- Meal planner dish library (grows over time from AI suggestions) ---
// "onedish" = bữa một tô/dĩa đầy đủ (bún, phở, cơm tấm…), không cần cơm + món mặn + canh kèm theo.
export type DishSlot = "breakfast" | "main" | "side" | "fruit" | "onedish";
export type FoodCategory = "Đạm" | "Rau củ" | "Tinh bột" | "Trái cây" | "Gia vị";
export interface MealIngredient {
  name: string;
  cat: FoodCategory;
  adult?: number; // per-adult amount; omitted for AI-learned dishes (name-only)
  child?: number; // per-child amount
  unit?: string;  // "g" = weight; otherwise a countable unit (quả, bó, củ…)
}
export interface StoredDish {
  id: string;
  name: string;
  slot: DishSlot;
  ingredients: MealIngredient[];
  source: "seed" | "ai";
  createdAt: string;
}

// The one shared weekly menu shown on the shopping view (persisted & synced).
export interface StoredMealPlan {
  days: { day: number; meals: { meal: string; dishes: string[] }[] }[];
  groceries: { name: string; cat: FoodCategory; quantity: string; meals?: string[]; dishes?: string[] }[];
  source: string;
  adults: number;
  children: number;
  updatedAt: string;
  updatedById: string;
}

// Một điểm lịch sử giá thị trường (chụp ~10 phút/lần trên server).
export interface MarketHistoryPoint {
  id: string;
  at: string;               // ISO timestamp
  btcUsd: number | null;
  ethUsd: number | null;
  goldSell: number | null;  // VND/lượng (SJC bán ra; fallback quy đổi từ XAU)
  usdVnd: number | null;
}

// Database schema container
export interface FamilyOrganizerDB {
  users: (User & { passwordHash: string })[];
  tasks: Task[];
  plans: FamilyPlan[];
  notes: Note[];
  transactions: FinancialTransaction[];
  rewardLedger: RewardPointEntry[];
  rewardItems: RewardItem[];
  budgets: BudgetLimit[];
  customCategories: CustomExpenseCategory[];
  hiddenBuiltinCategories: string[];
  recurringBills: RecurringBill[];
  savingsGoals: SavingsGoal[];
  debts: Debt[];
  assets: FamilyAsset[];
  medications: MedicationReminder[];
  medicationLogs: MedicationLog[];
  vaccinations: VaccinationRecord[];
  growthRecords: GrowthRecord[];
  healthProfiles: EmergencyProfile[];
  documents: FamilyDocument[];
  shoppingItems: ShoppingItem[];
  dishLibrary: StoredDish[];
  mealPlan?: StoredMealPlan | null;
  marketHistory: MarketHistoryPoint[];
  notifications: Notification[];
  pushSubscriptions: PushSubscriptionRecord[];
  activityLogs: {
    id: string;
    userId: string;
    username: string;
    action: string;
    details: string;
    createdAt: string;
  }[];
  backups: {
    id: string;
    filename: string;
    createdAt: string;
    sizeKb: number;
    type: "auto" | "manual";
  }[];
}
