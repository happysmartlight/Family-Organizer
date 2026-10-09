# 🏡 Family Organizer

Hệ thống quản lý gia đình tất-cả-trong-một — tài chính, lịch trình, nhiệm vụ, sức khỏe, giấy tờ, mua sắm, thưởng điểm cho trẻ và trợ lý AI — thiết kế để chạy ổn định 24/7 trên **Raspberry Pi 5** hoặc bất kỳ Linux server nào.

---

## 🏠 Chạy Ngay Tại Nhà Bạn (Self-hosted / Homelab)

Đây **không phải** dịch vụ trên mây thuê bao hàng tháng. Family Organizer chạy trên
**chính chiếc máy nhỏ đặt trong nhà bạn** — giống một "máy chủ gia đình" tí hon cắm
điện góc nhà, chạy êm 24/7. Toàn bộ dữ liệu (tài chính, sức khỏe, giấy tờ, ảnh hóa
đơn…) **nằm trên ổ đĩa nhà bạn**, không gửi lên máy chủ của bên thứ ba nào.

### Chạy được trên thiết bị gì?

Bất kỳ máy nào cài được **Docker** — chọn theo túi tiền và nhu cầu:

| Thiết bị | Phù hợp với | Ghi chú |
| :--- | :--- | :--- |
| **Raspberry Pi 5** (hoặc Pi 4) | Đa số gia đình | Nhỏ bằng lòng bàn tay, điện ~5W, êm và mát |
| **Mini PC** (Intel N100, NUC…) | Cần nhanh hơn, nhiều người dùng | Mạnh hơn Pi, vẫn tiết kiệm điện |
| **NAS** (Synology, TrueNAS…) | Nhà đã có sẵn NAS | Chạy chung như một ứng dụng Docker |
| **Máy tính cũ / Linux server** | Tận dụng máy sẵn có | Cài Docker là chạy |

> Không cần máy khủng: một chiếc **Pi mini ~1–2 triệu** là đủ cho cả gia đình dùng thoải mái.

### Vì sao chọn cách này?

- 🔒 **Riêng tư tuyệt đối** — dữ liệu ở nhà bạn, không ai khác đọc được.
- 💸 **Không phí thuê bao** — mua máy một lần, tiền điện mỗi tháng chỉ vài nghìn đồng.
- 📶 **Dùng mọi lúc mọi nơi** — trong nhà truy cập qua Wi-Fi/LAN; khi ra ngoài dùng
  **Tailscale** để vào an toàn mà *không cần mở cổng router hay IP tĩnh*.
- 📱 **Như một app điện thoại** — cài lên màn hình chính iPhone/Android (PWA), có
  thông báo đẩy, chạy toàn màn hình như ứng dụng thật.
- ♻️ **Tự cập nhật & tự sao lưu** — bấm một nút trong app để lên bản mới (tự sao lưu
  trước, bản mới lỗi thì tự quay về), hoặc bật tự cập nhật ban đêm; backup tự động mỗi
  đêm, có thể gửi kèm ra Telegram để cất offsite.

Xem hướng dẫn cài đặt chi tiết ở mục [🚀 Triển Khai Production (Raspberry Pi)](#-triển-khai-production-raspberry-pi) bên dưới.

---

## 📸 Ảnh Màn Hình

### Tổng quan — Sáng & Tối

Giao diện Neumorphism, hỗ trợ Light / Dark mode với hiệu ứng chuyển cảnh mượt.

| ☀️ Light | 🌙 Dark |
| :---: | :---: |
| ![Dashboard sáng](assets/dashboard-light.png) | ![Dashboard tối](assets/dashboard-dark.png) |

### Chi tiêu & Tài sản

| Thu chi & Ngân sách | Tài sản gia đình | Xu hướng & So sánh |
| :---: | :---: | :---: |
| ![Chi tiêu](assets/finance-overview.png) | ![Tài sản](assets/finance-assets.png) | ![Xu hướng chi tiêu](assets/finance-trends.png) |

### Nhiệm vụ, Lịch & Sức khỏe

| Nhóm Task + Điểm thưởng | Sức khỏe — Thẻ khẩn cấp | Sức khỏe — Tăng trưởng |
| :---: | :---: | :---: |
| ![Nhiệm vụ và điểm thưởng](assets/tasks-rewards.png) | ![Thẻ y tế khẩn cấp](assets/health-emergency-card.png) | ![Biểu đồ tăng trưởng](assets/health-growth.png) |

| Tạo nhiệm vụ | Đăng ký lịch trình | Giấy tờ gia đình |
| :---: | :---: | :---: |
| ![Modal tạo việc](assets/task-create-modal.png) | ![Modal tạo lịch](assets/plan-create-modal.png) | ![Kho giấy tờ](assets/documents.png) |

### Quản trị (Admin)

| Thành viên & Phân quyền | Hồ sơ cá nhân | Sao lưu & Khôi phục |
| :---: | :---: | :---: |
| ![Thành viên và phân quyền](assets/members-rbac.png) | ![Hồ sơ cá nhân](assets/settings-profile.png) | ![Backup và khôi phục](assets/settings-backup.png) |

| Quản lý Server — Sáng | Quản lý Server — Tối |
| :---: | :---: |
| ![Server monitor sáng](assets/server-monitor-light.png) | ![Server monitor tối](assets/server-monitor-dark.png) |

---

## ✨ Tính Năng

### 📊 Tổng Quan (Dashboard)

- Tóm tắt ngày: nhiệm vụ chờ xử lý, số dư quỹ gia đình, ghi chú ghim, sự kiện sắp tới
- Widget thời tiết theo 63 tỉnh/thành (nguồn Open-Meteo, không cần API key)
- Giá thị trường trực tiếp: BTC, ETH, Vàng SJC, tỷ giá USD/VND với sparkline 7 ngày
- Nhắc sinh nhật thành viên (ẩn nếu không có ai sắp sinh nhật), nhắc uống thuốc, danh sách mua sắm
- Nút **Nhắc người nhà**: gửi thông báo đẩy cho một thành viên hoặc cả nhà

### 📋 Nhiệm Vụ (Tasks)

- Tạo và phân công nhiệm vụ với 3 mức ưu tiên: Khẩn cấp / Bình thường / Thấp
- Bình luận thảo luận trực tiếp trong từng nhiệm vụ
- Trẻ em hoàn thành task → cộng điểm thưởng tự động

### 📅 Lập Lịch (Plans)

- Sự kiện đơn ngày và nhiều ngày, hiển thị dạng lưới theo thời gian
- Xuất file `.ics` tương thích iOS / Android / Google Calendar
- Private calendar feed (`/api/calendar.ics?token=...`) — đồng bộ 2 chiều với ứng dụng lịch bên ngoài
- Deep-link từ thông báo đẩy mở thẳng vào sự kiện cụ thể

### 📝 Ghi Chú (Notes)

- Soạn thảo Markdown đầy đủ (GFM): đầu mục, danh sách, checkbox, code inline, in đậm/nghiêng
- Toggle Soạn / Xem trước ngay trong cùng màn hình
- Ghim ghi chú quan trọng, phân quyền Công khai / Cá nhân
- Trợ lý AI viết nháp ghi chú từ ý tưởng ngắn (cần Gemini key)

### 💰 Chi Tiêu (Finance)

- Ghi thu nhập và chi tiêu theo danh mục (ăn uống, học tập, điện nước, y tế, đi lại, v.v.)
- Đính kèm ảnh hóa đơn (lưu file, không base64); tự chuyển ảnh HEIC của iPhone sang JPEG
- Biểu đồ tròn phân bổ dòng tiền, lọc theo tháng
- Xuất báo cáo PDF
- **Tài Sản** (Assets): Crypto (BTC/ETH giá live), Vàng (định giá tự động theo trọng lượng × giá 9999 × hệ số tuổi vàng), Bất động sản, Xe cộ, Cổ phiếu — kèm tính lời/lỗ so với giá mua
- **Ngân Sách** (Budgets): Hạn mức chi tiêu theo tháng, tùy chọn "Carry Forward" sang tháng sau
- **Hóa Đơn Tái Diễn** (Recurring Bills): Nhắc thanh toán định kỳ (điện, internet, bảo hiểm, v.v.)
- **Mục Tiêu Tiết Kiệm** (Savings Goals): Theo dõi tiến độ, thêm/ghi nhận đóng góp
- **Quản Lý Nợ** (Debt Tracker): Ghi khoản nợ, lịch trả, số tiền còn lại

### 🛒 Đi Chợ (Shopping)

- Danh sách mua sắm chung, đồng bộ thời gian thực cho cả nhà
- Đánh dấu đã mua từng món; xóa hàng loạt khi về chợ xong
- AI gợi ý thực đơn tuần (mẫu offline + Gemini) → tự tạo danh sách nguyên liệu gộp
- Thêm/xóa bằng **giọng nói** qua trợ lý AI (lệnh tự nhiên tiếng Việt)

### 💊 Sức Khỏe Gia Đình (Health)

- **Tăng Trưởng**: Ghi chiều cao / cân nặng theo thời gian, biểu đồ phát triển
- **Tiêm Chủng**: Lịch sử các mũi đã tiêm, ghi nhắc mũi sắp tới
- **Lịch Thuốc**: Đặt múc giờ uống nhiều lần/ngày, nhắc trên dashboard và thông báo đẩy, ghi nhận đã uống / bỏ lỡ

### 📄 Giấy Tờ (Documents)

- Kho lưu giấy tờ quan trọng (CMND, hộ chiếu, bảo hiểm, sổ đỏ, v.v.)
- Theo dõi ngày hết hạn, cảnh báo trước 30 ngày
- Phân theo chủ sở hữu, đính kèm ảnh scan

### 🎁 Thưởng Điểm (Rewards)

- Trẻ em tích điểm khi hoàn thành nhiệm vụ được giao
- Cửa hàng đổi thưởng: người lớn tạo danh sách quà có giá điểm cụ thể
- **Mystery Item**: rút thưởng bí ẩn ngẫu nhiên (gacha)
- Admin quản lý mẫu quà, duyệt yêu cầu đổi thưởng

### 🖥️ Quản Lý Server (Server Monitor — chỉ Admin)

- Theo dõi CPU, RAM, nhiệt độ, ổ đĩa theo thời gian thực
- Lịch sử 7 ngày dạng sparkline
- Shortcut link tới các dịch vụ homelab (Immich, Portainer, v.v.)
- **Cập nhật Immich** (khi chạy chung stack liu-homelab): so bản đang chạy với bản mới nhất trên GitHub, cảnh báo nếu có breaking changes, bấm để `docker compose pull` + `up -d` immich-server/immich-machine-learning
- Phiên bản & Cập nhật nằm ở **Thiết lập → Hệ thống & Sao lưu** (xem mục [Cập nhật](#cập-nhật))

### 🤖 Trợ Lý AI (Gemini)

- Tích hợp **Google Gemini API** — Admin nhập key trong Settings (lưu trong `app_settings.json`, không vào backup)
- Viết nháp ghi chú, gợi ý thực đơn, xử lý lệnh mua sắm bằng giọng nói
- **Bản tin tuần** (Weekly Digest): sáng thứ Hai 7h–10h gửi Telegram — tóm tắt chi tiêu, task trễ/sắp hạn, lịch sự kiện, sinh nhật, giấy tờ sắp hết hạn; AI viết thân thiện nếu có Gemini key

### 📲 Telegram Integration

- **Backup offsite**: gửi file ZIP (DB + uploads) qua Telegram bot mỗi đêm — lưu trữ ngoài server miễn phí
- **Bản tin tuần**: sáng thứ Hai 7h–10h gửi tóm tắt gia đình (bật/tắt riêng)
- Nút **Test** kiểm tra kết nối bot ngay trong Settings

### 🔔 Thông Báo & Đồng Bộ

- **Server-Sent Events (SSE)**: đồng bộ thời gian thực — không cần tải lại trang khi có thay đổi từ thành viên khác
- **Web Push (VAPID)**: thông báo đẩy native trên iOS/Android kể cả khi đóng app, kèm badge số và deep-link
- Thông báo nội bộ trong app (popup + badge)

### 🔍 Tìm Kiếm Toàn Cục

- Phím tắt `⌘K` / `Ctrl+K` — tìm đồng thời tasks, lịch, ghi chú, tài chính, giấy tờ

### 🌙 Giao Diện

- Light / Dark mode với hiệu ứng ripple transition (View Transitions API)
- PWA-first: safe-area, bottom nav, touch-friendly — tối ưu cho iPhone
- Tôn trọng `prefers-reduced-motion` của hệ thống

---

## 🔒 Phân Quyền (RBAC)

| Vai trò | Quyền hạn |
| :--- | :--- |
| **Admin (Gia trưởng)** | Toàn quyền: quản lý thành viên, đổi vai trò, backup/restore, log hệ thống, cập nhật app, cấu hình AI & Telegram |
| **Member (Thành viên)** | Tạo/sửa/xóa dữ liệu của mình; truy cập tài chính; không quản lý tài khoản người khác |
| **Child (Trẻ em)** | Xem lịch và ghi chú công khai; cập nhật task của mình; kiếm và đổi điểm thưởng; không truy cập tài chính |
| **Guest (Khách)** | Chỉ xem lịch và ghi chú công khai |

---

## 🚀 Triển Khai Production (Raspberry Pi)

Ứng dụng chạy từ image CI build và publish lên **GitHub Container Registry (GHCR)** mỗi bản phát hành (tag `vX.Y.Z`). Container **`family-organizer-updater`** đi kèm lo việc cập nhật khi bấm nút trong app — không cần terminal sau lần cài đầu.

### Yêu cầu hệ thống

- Raspberry Pi 5 (hoặc bất kỳ Linux server nào)
- Docker Engine **29+** và Docker Compose v2

### Cài lần đầu

**Bước 1 — Cài Docker:**

```bash
curl -fsSL https://get.docker.com | sudo sh
```

**Bước 2 — Clone repo và tạo `.env`:**

```bash
git clone https://github.com/happysmartlight/Family-Organizer.git
cd Family-Organizer
cp .env.example .env
echo "STACK_DIR=$PWD" >> .env   # dịch vụ cập nhật cần đường dẫn tuyệt đối của thư mục này
nano .env
```

**Bước 3 — Khởi chạy:**

```bash
docker compose up -d
```

Lần đầu tự pull image từ GHCR. Ứng dụng khả dụng tại:

- `http://localhost:3001` — từ chính máy server
- `http://<ip-lan-cua-pi>:3001` — từ mạng nội bộ

Dữ liệu lưu bền vững tại `./data/` trên máy host.

### 🌐 Bonus — Truy Cập Từ Xa Qua Tailscale (ra ngoài vẫn dùng được)

Mặc định app chỉ chạy trong **mạng nội bộ (LAN)** — ở nhà thì tiện, nhưng ra ngoài
đường là không vào được. Giải pháp gọn và an toàn nhất là **Tailscale**: nó tạo một
mạng riêng ảo giữa các thiết bị của bạn, **không cần mở cổng router, không cần IP
tĩnh, không lộ app ra Internet công cộng**. Miễn phí cho nhu cầu gia đình.

> 💡 **Ý tưởng:** cài Tailscale lên *máy chủ (Pi)* và lên *điện thoại/laptop* của các
> thành viên. Chúng "nhìn thấy" nhau như đang cùng một mạng, dù bạn đang ở bất cứ đâu.

**Bước 1 — Tạo tài khoản Tailscale:** đăng ký miễn phí tại [tailscale.com](https://tailscale.com) (đăng nhập bằng Google/Microsoft/GitHub).

**Bước 2 — Cài Tailscale lên máy chủ (Pi/mini PC):**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Chạy xong, terminal hiện một đường link — mở link đó bằng trình duyệt để đăng nhập và
xác nhận thiết bị. Kiểm tra địa chỉ IP Tailscale (dạng `100.x.x.x`) của máy:

```bash
tailscale ip -4
```

**Bước 3 — Cài Tailscale lên điện thoại/laptop:** tải app **Tailscale** trên
App Store / Google Play (hoặc bản desktop), đăng nhập *cùng một tài khoản*, rồi bật kết nối.

**Bước 4 — Vào app từ bất cứ đâu:** chỉ cần điện thoại đã bật Tailscale, mở trình duyệt:

```text
http://100.x.x.x:3001
```

(thay `100.x.x.x` bằng IP Tailscale của Pi ở Bước 2). Cứ để mở bằng địa chỉ này là
dùng được cả khi ở nhà lẫn khi ra ngoài — không cần đổi qua lại IP LAN nữa.

#### (Tùy chọn) Có HTTPS + tên đẹp để bật thông báo đẩy trên iPhone

Thông báo đẩy PWA trên iPhone **yêu cầu HTTPS**. Tailscale cấp sẵn HTTPS miễn phí qua
lệnh `tailscale serve` — trỏ tên miền `*.ts.net` của bạn về app:

```bash
sudo tailscale serve --bg 3001
```

Sau đó vào app bằng địa chỉ HTTPS mà lệnh in ra (dạng `https://ten-may.ten-tailnet.ts.net`).
Dùng chính địa chỉ HTTPS này khi **Cài lên màn hình chính (PWA)** và đặt vào biến
`APP_URL` trong `.env` để deep-link trong thông báo đẩy hoạt động đúng.

> ⚠️ **Đừng dùng `tailscale funnel`** trừ khi bạn thực sự muốn mở app ra Internet công
> khai. `serve` chỉ chia sẻ trong mạng riêng của bạn — đúng nhu cầu gia đình và an toàn hơn.

### Cập nhật

Vào **Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật** (Admin):

- Danh sách phiên bản kèm ghi chú thay đổi (lấy từ GitHub Releases), app tự kiểm tra mỗi 6 giờ.
- **Cập nhật ngay**: app chụp lại database → container `family-organizer-updater` kéo image
  mới, khởi động lại, chờ `/api/health` báo đúng phiên bản. Bản mới không lên được → **tự quay
  về bản cũ** và khôi phục database lúc trước khi cập nhật.
- **Quay về** bất kỳ bản cũ nào, tùy chọn khôi phục cả dữ liệu từ bản chụp trước cập nhật.
- **Tự cập nhật ban đêm** theo giờ chọn; báo qua Telegram nếu đã cấu hình bot.
- Mọi máy đang mở app thấy banner **"Đã có bản mới vX.Y.Z"** để tải lại.

Dịch vụ cập nhật không mở cổng mạng: app và nó trao đổi qua file trong `data/update/`
(script: [deploy/updater.sh](deploy/updater.sh)). Phiên bản đang chạy nằm ở biến
`FAMILY_ORGANIZER_VERSION` trong `.env` — đừng sửa tay khi đã dùng nút cập nhật.

**Thủ công** (khi dịch vụ cập nhật không chạy):

```bash
cd ~/Family-Organizer && sed -i 's/^FAMILY_ORGANIZER_VERSION=.*/FAMILY_ORGANIZER_VERSION=1.2.3/' .env && docker compose up -d
```

**Phát hành bản mới (người phát triển):** thêm mục `## [X.Y.Z]` vào [CHANGELOG.md](CHANGELOG.md)
→ `npm run release -- X.Y.Z` → `git push && git push --tags`. GitHub Actions build image arm64 +
tạo Release; app trên máy chủ thấy bản mới trong trang Cập nhật.

---

## 💻 Môi Trường Dev (Local)

### Yêu cầu phần mềm

- Node.js 22+

### Chạy dev server

```bash
npm install
cp .env.example .env
npm run dev
```

Ứng dụng khởi động tại `http://localhost:3000`.

> Để test AI trong dev: nhập Gemini key trực tiếp trong **Settings → Thiết lập AI** (hoặc đặt `GEMINI_API_KEY` trong `.env` làm fallback).

### Build production

```bash
npm run build && npm start
```

### Tests

```bash
npm test            # chạy một lần
npm run test:watch  # theo dõi khi sửa code
```

---

## 🔑 Tài Khoản Mặc Định

Khi khởi động lần đầu hoặc sau khi xóa `data/family.db`, hệ thống tự tạo:

| Vai trò | Username | Mật khẩu |
| :--- | :--- | :--- |
| Admin | `admin` | `admin123` |

> **Đổi mật khẩu ngay** sau khi deploy. Vào **Settings → Thành viên & Phân quyền** để thêm tài khoản cho từng thành viên.

---

## 🌐 Đa Ngôn Ngữ (i18n)

Family Organizer hỗ trợ nhiều ngôn ngữ nhờ **react-i18next**. Khi đăng nhập lần đầu, ứng dụng tự phát hiện ngôn ngữ trình duyệt; người dùng có thể đổi bất cứ lúc nào.

### Ngôn ngữ hiện hỗ trợ

| Cờ | Ngôn ngữ | Mã | Trạng thái |
| :---: | :--- | :---: | :--- |
| 🇻🇳 | Tiếng Việt | `vi` | ✅ Bản gốc |
| 🇬🇧 | English | `en` | ✅ Đầy đủ |
| 🇨🇳 | 中文 (giản thể) | `zh` | ✅ Đầy đủ |

### Cách thay đổi ngôn ngữ

1. Mở **Thiết lập** (icon bánh răng góc trái dưới)
2. Chọn tab **Hệ thống**
3. Tìm mục **Ngôn ngữ giao diện** → chọn ngôn ngữ mong muốn
4. Giao diện chuyển ngay lập tức — không cần tải lại trang

Lựa chọn được lưu vào `localStorage` (`family_lang`), áp dụng riêng cho từng thiết bị.

### Đóng góp bản dịch

Thêm ngôn ngữ mới chỉ cần **3 bước** — không đụng tới code UI:

#### Bước 1 — Tạo file locale

```bash
cp src/i18n/locales/vi.json src/i18n/locales/<mã-ngôn-ngữ>.json
# Ví dụ: ja.json, ko.json, fr.json...
```

Dịch toàn bộ phần **value** (giữ nguyên key). `vi.json` là bản gốc/nguồn sự thật — mọi key mới đều vào đây trước.

#### Bước 2 — Đăng ký vào `src/i18n/index.ts`

```ts
import ja from "./locales/ja.json";          // thêm import

export const SUPPORTED_LANGUAGES = [
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "en", label: "English",    flag: "🇬🇧" },
  { code: "zh", label: "中文",        flag: "🇨🇳" },
  { code: "ja", label: "日本語",      flag: "🇯🇵" },  // ← thêm
] as const;

const resources = {
  vi: { translation: vi },
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },                   // ← thêm
};
```

#### Bước 3 — Gửi Pull Request

Bộ chọn ngôn ngữ trong Settings sẽ tự hiện lựa chọn mới — không cần thay đổi thêm gì. Xem hướng dẫn chi tiết và quy ước key tại [`src/i18n/MIGRATION_GUIDE.md`](src/i18n/MIGRATION_GUIDE.md).

---

## 🔧 Biến Môi Trường

Các biến đặt trong file `.env` ở thư mục gốc (được `docker-compose.yml` đọc tự động).

| Biến | Bắt buộc | Mô tả |
| :--- | :---: | :--- |
| `STACK_DIR` | Có | Đường dẫn tuyệt đối tới thư mục chứa `docker-compose.yml` — dịch vụ cập nhật cần để chạy `docker compose` |
| `FAMILY_ORGANIZER_VERSION` | Không | Phiên bản image đang chạy (vd `1.0.0`); trống = `latest`. Nút cập nhật tự đổi biến này |
| `GEMINI_API_KEY` | Không | Fallback Gemini key khi chưa cấu hình qua Settings UI |
| `VAPID_PUBLIC_KEY` | Không | VAPID public key — bật thông báo đẩy PWA |
| `VAPID_PRIVATE_KEY` | Không | VAPID private key |
| `VAPID_SUBJECT` | Không | Email liên hệ cho VAPID (dạng `mailto:you@example.com`) |
| `APP_URL` | Không | URL ngoài của app — dùng cho deep-link trong thông báo đẩy |
| `GITHUB_REPO` | Không | Repo GitHub để đọc danh sách bản phát hành (mặc định: `happysmartlight/Family-Organizer`) |

> **Gemini key và cấu hình Telegram** được quản lý qua **Settings → Thiết lập AI / Telegram** trong giao diện — lưu vào `app_settings.json`, không vào backup. Biến môi trường `GEMINI_API_KEY` chỉ là fallback nếu chưa nhập qua UI.
> **VAPID keys** tạo bằng: `npx web-push generate-vapid-keys`

---

## 📁 Cấu Trúc Dữ Liệu

```text
./data/
├── family.db          # Database chính (SQLite)
├── app_settings.json  # API keys & cấu hình Telegram (không vào backup)
├── backups/           # Backup tự động 24h và thủ công
└── uploads/           # Ảnh hóa đơn, avatar, tài sản, giấy tờ (file, không base64)
```

---

## 🛠️ Hướng Dẫn Admin

### Quản lý thành viên

Settings → Thành viên & Phân quyền → Tạo mới hoặc chỉnh sửa vai trò / mật khẩu.

### Backup & Restore

- **Tự động**: mỗi 24h vào `./data/backups/`
- **Thủ công**: Settings → Lưu trữ & Sao lưu → Tạo backup
- **Khôi phục**: Chọn điểm backup → Khôi phục → Server tự reload
- **Telegram offsite**: bật trong Settings → Telegram để gửi ZIP backup ra ngoài mỗi đêm

### Reset toàn bộ

```bash
docker compose down
rm data/family.db
docker compose up -d
```

---

## 🏗️ Tech Stack

| Layer | Thư viện / Công cụ |
| :--- | :--- |
| **Frontend** | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| **Animation** | Motion 12 (Framer Motion successor) |
| **Markdown** | react-markdown 10 + remark-gfm |
| **Backend** | Express 4, Better-SQLite3 11, Node.js 22 |
| **AI** | Google GenAI SDK 2 (Gemini 2.5 Flash) |
| **Notifications** | Web Push / VAPID, SSE |
| **Export** | pdfmake 0.3 (báo cáo tài chính), archiver 8 (ZIP backup) |
| **Container** | Docker multi-stage (Alpine), GHCR, dịch vụ cập nhật riêng (`docker:cli` + sh) |
| **Testing** | Vitest 4 |

---

Chúc gia đình bạn sử dụng vui vẻ! 🏡
