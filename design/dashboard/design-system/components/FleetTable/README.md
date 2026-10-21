# FleetTable

Bảng mọi task chưa accept, nhóm theo việc cần làm: Chờ bạn → Bất thường → Đang chạy → Hàng chờ. Mỗi task xuất hiện đúng một lần.

- `groups`: `{key, label, tone, hint, rows}`; `row`: `{id, type, isNew, title, line, project, profile, backend, runtime, round, generation, age:{text,tone,sub}, points:{open,user}, status}`.
- `line` là dòng phụ theo ngữ cảnh: câu hỏi cần quyết (đỏ), lý do bất thường (vàng), câu đầu của report gần nhất.
- `selected`/`onSelect` (bấm, Space), `onOpen` (bấm đúp, Shift+Enter); `dense` cho mật độ gọn; `layout="cards"` dưới `bp-tablet`.
- Nhóm thu gọn được; nhóm rỗng hiện “Không có.” thay vì biến mất.
- Kiểu sổ cái: viền `bw-ledger`, đầu cột condensed in hoa, dòng ngăn gạch đứt, mã task condensed 18px, dòng chọn có vạch mực bên trái.
