# Foreman dashboard — design đã chốt

Design cho web dashboard độc lập ở issue #30: `foreman dashboard serve`, chỉ đọc, bind `127.0.0.1`.
Direction **Manifest / Paper Tag**, bản v4.1 — nhận diện phiếu kho nằm ở khung, phần dữ liệu ưu tiên đọc nhanh.

| File | Nội dung |
|---|---|
| [`foreman-dashboard.html`](foreman-dashboard.html) | Bản design đầy đủ, một file, mở thẳng bằng trình duyệt. Dữ liệu mẫu; nút “Bản thiết kế” góc dưới phải giả lập sự kiện và mở ghi chú thiết kế. |
| [`design-system/index.html`](design-system/index.html) | Gallery 52 component, chạy offline. |
| [`design-system/README.md`](design-system/README.md) | Brand book: màn hình, giọng văn và thuật ngữ, hai trục trạng thái, màu, chữ, viền, tương tác, bố cục. |
| [`design-system/tokens.json`](design-system/tokens.json) · [`tokens.css`](design-system/tokens.css) | Design token, theme sáng (Ca ngày) và tối (Ca đêm). |
| [`design-system/bundle.js`](design-system/bundle.js) · [`bundle.css`](design-system/bundle.css) · [`index.d.ts`](design-system/index.d.ts) | Component đã build (`window.Foreman`, cần React 18 trên `window`) và kiểu props. |
| `design-system/components/<Tên>/` | README và preview của từng component. |
| `design-system/src/` | Mã nguồn tham khảo: `ds/` (component, vocab, CSS) và `app/` (các màn, model suy diễn từ snapshot, dữ liệu mẫu). |
| `design-system/vendor/` | React 18.3.1 UMD (MIT) để gallery chạy không cần mạng. |

## Màn hình

Thanh trên: **Tổng quan · Chờ bạn · Task · Timeline** | **Health · Dự án & lease · Token & cache · Cài đặt**, cộng trang task `#/task/T-41`.

- **Tổng quan** (mặc định): kanban agent theo runtime state (Đang chạy · Idle · Chờ input · Không rõ / mất), kanban mọi task chưa accept theo bốn cột Hàng chờ · Đang làm · Cần bạn · Chờ duyệt, khung xem nhanh bên phải.
- **Chờ bạn**: quyết định, bị chặn, chọn model, chờ duyệt, attention — lâu nhất trước, đọc đủ Decision Package và report.
- **Task**: bảng mọi task chưa accept, lọc theo dự án, trạng thái và từ khoá, bấm để mở trang task; bên dưới là task đã kết thúc, không có link.
- **Timeline**: thời gian theo task (agent làm hay chờ bạn) và nhật ký sự kiện, gồm task đã kết thúc từ `data/task-history.jsonl`.
- **Health**: status check, task collect, heartbeat Paseo, runtime, bất thường, notice chưa báo, outbox.
- **Dự án & lease**: slot đã dùng, lease đang giữ và chồng lấn, phụ thuộc.
- **Token & cache**: tách khỏi màn chính; đang là số liệu mẫu cho tới khi có nguồn thật (#28).
- **Cài đặt**: tùy chọn hiển thị lưu ở trình duyệt, routing profile, nguồn dữ liệu, phím tắt.

Tổng quan, Chờ bạn và trang task không có nút copy; chúng hiện báo cáo của Foreman đúng như trong phiên Foreman, và round chỉ hiện lời gốc của bạn.
Dashboard không gửi gì cho agent và không ghi state.

Đã kiểm ở 390, 768, 1024, 1280, 1440px, cả hai theme; chữ trên nền đạt ≥ 4.5:1.
