# Thay đổi

Ghi theo phiên bản, mới nhất ở trên. Nội dung mục của từng phiên bản được dùng làm ghi chú
hiển thị trong **Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật**.

## [1.0.0] - 2026-10-09

Bản phát hành đầu tiên có số phiên bản. Từ bản này, app được cập nhật ngay trong
**Thiết lập → Hệ thống & Sao lưu → Phiên bản & Cập nhật** — không cần mở terminal.

### Cập nhật kiểu mới
- **Xem trước có gì mới**: mỗi phiên bản kèm ghi chú thay đổi, đọc ngay trong app trước khi cài.
- **Cập nhật một chạm**: bấm **Cập nhật ngay**, app tự sao lưu dữ liệu, tải bản mới, khởi động lại và hiện tiến trình từng bước (Sao lưu → Tải bản mới → Khởi động lại → Kiểm tra → Xong). Xong tự tải lại trang.
- **Tự cứu khi lỗi**: bản mới khởi động không lên thì tự quay về bản đang chạy và khôi phục dữ liệu lúc trước khi cập nhật.
- **Quay về bản cũ**: chọn bất kỳ phiên bản trước trong danh sách; có thể khôi phục cả dữ liệu về lúc trước khi cập nhật nếu bản mới làm hỏng dữ liệu.
- **Tự cập nhật ban đêm** (tùy chọn): chọn giờ, có bản mới thì app tự cài.
- **Báo qua Telegram** (nếu đã cấu hình bot): khi có bản mới, khi bắt đầu cập nhật và khi xong / bị quay về.
- Banner **"Đã có bản mới vX.Y.Z"** hiện trên mọi máy đang mở app, bấm để tải lại.
- Thay Watchtower bằng dịch vụ cập nhật riêng (`family-organizer-updater`): không mở cổng mạng, chỉ đụng tới Family Organizer, không ảnh hưởng ứng dụng khác chạy chung máy.

### Cần làm một lần trên Pi
- Stack liu-homelab: `cd ~/liu-homelab && git pull && sudo bash setup.sh` (thêm dịch vụ cập nhật, bỏ Watchtower). Các lần sau cập nhật hoàn toàn trong app.
