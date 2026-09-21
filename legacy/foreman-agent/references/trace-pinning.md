# Ghim transcript

File tham chiếu của `foreman-agent`.
Đọc file này khi người dùng duyệt hoặc từ chối một item, ngay sau khi đã ghi xong `backlog.md`, `done.md`, và `log.md`.

## Việc phải làm

Copy transcript thô của worker vào `.foreman/traces/`.
Bạn chỉ copy, không phân tích, không chuẩn hoá.
Dòng `done.md` là nhãn, `log.md` là sự kiện, transcript là bằng chứng vì sao.

Lý do copy chứ không đọc: runtime tự xoá transcript cũ sau một thời gian, nên tới lúc ai đó muốn đánh giá thì bằng chứng đã bốc hơi.
Copy là để ghim nó lại.

```bash
D=.foreman/traces/T-10-20260812-1605
for f in $(grep -rl "TASK: T-10 " ~/.claude/projects ~/.codex/sessions 2>/dev/null); do
  grep -q "backlog\.md" "$f" || { mkdir -p "$D"; cp "$f" "$D"/; }
done
```

Chỉ dùng `grep`, `cp`, `mkdir` — không gọi skill nào khác và không cần `python3`.
Đây là ràng buộc bắt buộc: bạn là skill toàn máy và chạy ở cả những repo chưa bao giờ cài workflow, nên không được phụ thuộc vào script của repo.

## Vì sao lệnh viết như vậy

Chuỗi tìm kiếm là `TASK: <id> ` kèm **dấu cách cuối**, vì mẫu prompt luôn mở đầu bằng `TASK: T-14 · …`.
Dấu cách đó phân biệt `T-1` với `T-10`.

Điều kiện `grep -q "backlog\.md"` loại **transcript của chính bạn** ra.
Bạn in lại nguyên prompt đã gửi cho người dùng xem, nên chuỗi `TASK: <id>` cũng nằm trong phiên của bạn.
Worker bị cấm đọc `backlog.md` và chỉ được ghi đúng `.foreman/inbox/<id>--<agent>.md`, còn Foreman luôn đọc `backlog.md`, nên đó là dấu hiệu phân biệt chắc chắn.

Copy **hết** các transcript khớp, không chọn cái mới nhất.
Item đi qua nhiều agent thì mỗi agent một file, và cả chuỗi đó mới là dấu vết của lần rework.

Worker chạy trên runtime lưu lịch sử trong cơ sở dữ liệu thay vì file thì vòng lặp không khớp gì cả, và đúng là không cần: loại đó không tự xoá lịch sử, tìm lúc nào cũng được.

Tên thư mục là `<id>-<YYYYMMDD-HHMM>` theo thời điểm copy.
Một item bị từ chối rồi mới được duyệt sẽ có hai thư mục; giữ cả hai.

## Năm luật

- Không hỏi người dùng, không xác nhận, không báo cáo trừ khi họ hỏi thẳng.
- Không mở, không đọc, không tóm tắt file vừa copy.
- Lệnh thất bại thì bỏ qua im lặng, không thử lại, không ghi dòng friction.
- Item chưa giao cho ai thì bỏ qua, vì không có transcript nào để tìm.
- Chỉ copy lúc duyệt và lúc từ chối.
  Không copy lúc giao việc, lúc flag, lúc đối chiếu khởi động, hay khi người dùng chỉ hỏi trạng thái.
