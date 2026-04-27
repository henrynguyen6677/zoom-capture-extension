# 4-Button Media Capture Downloader (Chrome Extension)

## Cài đặt
1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Trỏ tới thư mục: `/Users/henry/zoom-capture-extension`.

## Cách dùng (siêu đơn giản)
1. Mở trang có video và phát video vài giây.
2. Bấm **1. Capture Link**.
3. Bấm **2. Tải cURL Local**.
4. Nếu cần lệnh thủ công, bấm **4. Export cURL**.

## Nút chức năng
- **1. Capture Link**: lấy link media mới nhất từ tab hiện tại.
- **2. Tải cURL Local**: chạy `curl` local qua Native Messaging.
- **3. Mở file**: mở vị trí file đã tải.
- **4. Export cURL**: copy lệnh `curl` đầy đủ vào clipboard.
- **Reset trạng thái**: xóa trạng thái để làm lại từ đầu.

## Setup Native Host
1. Mở `chrome://extensions`, copy **Extension ID**.
2. Chạy: `bash /Users/henry/zoom-native-host/install_native_host.sh <EXTENSION_ID>`.
3. Reload extension.

## Ghi chú
- Extension dùng `webRequest` để nghe URL media đang phát.
- Với một số website có chống tải rất chặt, link có thể hết hạn nhanh; khi đó chỉ cần phát lại và capture lại.
