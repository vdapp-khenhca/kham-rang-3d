# Khám Răng 3D: hướng dẫn cài đặt và cập nhật

## 1. Dùng thử ngay (không cần cài)
Giải nén file `KhamRang3D-1.0.0-win-dung-thu.zip`, mở thư mục, bấm đúp `Khám Răng 3D.exe`.
Bản này chạy được đầy đủ nhưng chưa có nút tự cập nhật. Bản có cập nhật là bản cài đặt ở mục 2.

## 2. Bản cài đặt có nút Cập nhật (làm một lần)
App cập nhật qua GitHub Releases. Bạn cần một tài khoản GitHub miễn phí.

1. Vào https://github.com/new, đặt tên kho là `kham-rang-3d`, chọn **Public**, bấm Create.
   (Kho chỉ chứa phần mềm. Hồ sơ khách và file scan nằm trên máy của phòng khám, không bao giờ lên GitHub.)
2. Bấm "uploading an existing file", kéo toàn bộ nội dung thư mục `kham-rang-3d` (không gồm `node_modules`, `dist`) vào, bấm Commit.
   Nhớ upload cả thư mục ẩn `.github` (chứa file `workflows/release.yml`).
3. Vào **Settings → Actions → General → Workflow permissions**, chọn **Read and write permissions**, Save.
4. Vào **Releases → Draft a new release**, ở ô Tag gõ `v1.0.0`, bấm Create new tag, rồi Publish release.
5. Đợi khoảng 5 đến 8 phút (xem tiến độ ở tab Actions). Khi xong, trong Releases có file `Khám Răng 3D Setup 1.0.0.exe`. Tải về và cài vào các máy.
6. Mở app → Cài đặt → mục "Cập nhật phần mềm" → nhập `ten-github-cua-ban/kham-rang-3d` → Lưu. (Nếu build bằng cách trên, app đã tự biết kho nên bước này có thể bỏ qua.)

## 3. Mỗi lần có bản mới
1. Sửa dòng `"version"` trong `package.json` (ví dụ `1.0.1`) và thay các file đã đổi.
2. Tạo release mới với tag trùng số phiên bản (`v1.0.1`).
3. Sau khi build xong, trên các máy đang mở app sẽ hiện thanh **"Có bản mới 1.0.1 [Cập nhật ngay]"**. Bấm là tải và cài, app tự khởi động lại. Dữ liệu khách không bị ảnh hưởng.

Windows có thể cảnh báo "Windows protected your PC" khi cài lần đầu vì app chưa mua chứng chỉ ký số. Bấm "More info" rồi "Run anyway". Các lần cập nhật sau không hỏi lại.

## 4. Thiết lập AI và phiếu khám
Mở app → Cài đặt:
- Nhập tên, địa chỉ, điện thoại, bác sĩ, logo phòng khám (hiện trên phiếu PDF).
- Nhập khóa API OpenAI (GPT). Khóa được mã hóa, chỉ lưu trên máy.
- Có thể sửa "Quy tắc phòng khám" để dạy AI cách trả lời cho mọi khách.

## 5. Dữ liệu nằm ở đâu
Cài đặt → mục Dữ liệu → "Mở thư mục dữ liệu". Sao lưu thư mục này định kỳ.
