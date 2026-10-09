# Family Organizer

## Thiết kế giao diện — ĐỌC TRƯỚC KHI TẠO/ĐỔI UI

Toàn bộ quy ước phong cách (màu, theme Sáng/Tối, typography, component, layout,
modal, FAB, safe-area) nằm trong **[DESIGN.md](DESIGN.md)** — nguồn chân lý chung
cho người và AI. Khi tạo màn hình hoặc component mới, hãy tuân theo file đó: ưu
tiên tái dùng các lớp Tailwind mẫu sẵn có thay vì tự nghĩ ra giá trị mới, và bám
checklist ở cuối DESIGN.md trước khi hoàn tất.

## Phiên bản & phát hành

App có số phiên bản (semver) — push lên `main` chỉ chạy CI kiểm tra, **không** tạo image
và máy đang chạy không nhận code mới. Muốn người dùng có bản mới thì phải phát hành:

1. Thêm mục `## [X.Y.Z] - YYYY-MM-DD` vào đầu [CHANGELOG.md](CHANGELOG.md) — tiếng Việt,
   viết cho người dùng gia đình (nội dung hiện nguyên văn trong trang Cập nhật).
2. `npm run release -- X.Y.Z` (đặt version, lint + test, commit `release: vX.Y.Z`, tag).
3. `git push && git push --tags` → [release.yml](.github/workflows/release.yml) build image
   arm64 lên GHCR + tạo GitHub Release.

Cơ chế cập nhật: [server/updater.ts](server/updater.ts) (app, giao tiếp qua file trong
`data/update/`) + [deploy/updater.sh](deploy/updater.sh) (container `family-organizer-updater`,
sh thuần/busybox — CI chạy `sh -n`). Trên Pi app nằm trong stack **liu-homelab** (dùng chung
với Immich…), nên updater chỉ được đụng service `family-organizer` (và, với hành động
`immich` do admin bấm ở Quản lý Server, các service trong `IMMICH_SERVICES` mà nó tự dò
thấy trong compose) — không thay compose. App chỉ gửi tên hành động, không gửi lệnh/service.
Đổi `updater.sh` thì máy đang chạy tự nhận bản mới ở lần cập nhật kế tiếp (tải từ tag).
Dữ liệu mới nên thêm theo kiểu không phá bản cũ — người dùng có thể "Quay về" bản trước
trên cùng database.
