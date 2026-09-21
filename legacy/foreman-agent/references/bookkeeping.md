# Duyệt, từ chối và ghi friction

Playbook của `foreman-agent`.
Nạp khi Human duyệt hoặc từ chối một item, hoặc khi sắp ghi một dòng vào `log.md`.

## Duyệt

Khi Human duyệt `[v]`, append vào `done.md` dưới heading tháng:

```markdown
- T-10 Thêm test idempotency · @codex-1 · giao 2026-08-11 11:02 · duyệt 2026-08-11 16:05 · ↻3
```

Chép assignment và `↻N` trước khi xoá backlog item.
Sau đó xoá progress snapshot, ghim trace theo `trace-pinning.md`, gỡ đúng field `— chờ <id>` khỏi item phụ thuộc, rồi xét tự giao item vừa mở khoá theo `assigning.md`.

Cả chuỗi này báo đúng một dòng theo `## Xác nhận sau thao tác` trong `reporting.md`.
Bốn thao tác file bên trên là việc nhà, không phải tin tức.

## Từ chối

Khi Human không duyệt `[v]`:

1. tăng `↻N`, ghi nguyên văn lý do vào `↳ bạn không nhận <ngày>: …`;
2. agent còn sống thì đưa về `[~]`, gửi nguyên văn lý do như rejection message, không ghi `followup`, và ghi snapshot thành `working`;
3. agent mất thì đưa về `[ ]`, bỏ assignment nhưng giữ snapshot để handoff;
4. ghi đúng một dòng `rejected` vào `log.md`;
5. ghim trace theo `trace-pinning.md`.

Human từ chối mà không nêu lý do thì hỏi một câu; đó là một trong bốn ca được phép hỏi.

Không bao giờ đi từ worker claim thẳng sang `[x]`.

## Ghim trace

Khi người dùng duyệt hoặc từ chối một item, ghim transcript thô của worker vào `.foreman/traces/`.
Ghim xong là thôi; không bao giờ đọc lại.

Đọc file này trước khi làm:

```text
~/.claude/skills/foreman-agent/references/trace-pinning.md
```

Nó chứa lệnh copy và luật đi kèm.
Đừng dựng lệnh từ trí nhớ.

Không đọc được file thì **bỏ qua việc ghim, im lặng**, và tiếp tục lượt bình thường.
Đây là bước phụ; nó không bao giờ được chặn việc duyệt hay từ chối.

## Ghi friction

`log.md` chỉ chứa những gì **lệch khỏi đường trơn tru**.
Happy path đã có `done.md`; không ghi trùng vào đây.

Append một dòng `YYYY-MM-DD HH:MM  <id>  <@agent>  <loại>  <chi tiết>` khi và chỉ khi:

| Loại | Ghi tại thao tác nào | Điều kiện |
| --- | --- | --- |
| `requeue` | reconcile | item `[~]` mất worker |
| `blocked` | triage | worker đã cung cấp Decision Package và thật sự cần Human |
| `bad-inbox` | áp inbox | file sai format, id không tồn tại hoặc owner không khớp |
| `followup` | relay thay đổi yêu cầu | Human bổ sung hoặc đổi scope ngoài decision/rejection đã có event riêng |
| `rejected` | Human không duyệt `[v]` | mọi lần |
| `ambiguous` | kiểm trước khi gửi | prompt có context-only reference, các dòng `↳` chọi nhau hoặc cặp ngoặc hỏng |
| `override` | giao việc | vẫn gửi sau cảnh báo dependency hoặc overlap |
| `flagged` | Human quan sát item có vấn đề | lời họ không kèm chỉ thị kiểm tra hay thay đổi |

```text
2026-09-17 14:20  T-13  @codex-1   requeue    agent mất session khi đang chạy
2026-09-17 15:02  T-14  @codex-1   followup   giới hạn theo user thay vì theo IP
2026-09-17 16:40  T-12  @claude-2  blocked    cần chọn reuse hoặc rotate refresh token
2026-09-17 17:10  T-10  @codex-1   rejected   test còn thiếu case 429
```

`@agent` lấy từ assignment tại lúc xảy ra sự kiện; chưa giao thì ghi `-`.

### Cái gì không phải friction

Status request, lấy Decision/Completion Package, relay câu hỏi sâu, relay decision, nhắc idle worker và handoff thành công là supervision happy path: không ghi `followup`, không tăng `↻N`.

Không ghi happy path: tạo task, giao lần đầu, progress query, worker complete, Human duyệt, decision relay hoặc handoff thành công.
Phần trơn tru được đếm ở `done.md`.

Việc soát lời người dùng không phải friction; chỉ ca `ambiguous` mới ghi.

`flagged` không đổi trạng thái, không tăng `↻N`, không tự gửi worker.
Nếu Human yêu cầu kiểm tra hoặc thay đổi thì đó không còn là `flagged`: query operational không log; thay đổi scope thì `followup`.

### Sau khi ghi

Ghi xong không đọc lại `log.md` trong lúc chạy bình thường.
Chỉ đọc khi Human hỏi thẳng về friction hoặc muốn tổng hợp.
Không tự chẩn đoán nguyên nhân từ log.

## Cấm

- Không đi từ worker claim thẳng sang `[x]`.
- Không xoá backlog item trước khi chép xong assignment và `↻N` sang `done.md`.
- Không ghi happy path vào `log.md`.
- Không ghi quá một dòng cho một sự kiện.
- Không đọc lại `log.md` trong lúc chạy bình thường, và không tự chẩn đoán nguyên nhân friction.
- Không để việc ghim trace chặn việc duyệt hay từ chối.
