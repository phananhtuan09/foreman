# Worker I/O

Playbook của `foreman-agent`.
Nạp khi sắp gửi bất cứ request nào cho worker, hoặc khi `inbox/` có file.

Mẫu prompt cho từng loại request nằm ở `assigning.md`; file này sở hữu việc **gửi đi rồi lấy về**.

## Lấy response

Gửi một operational request mới là nửa việc.
Request không được đọc về và ghi xuống đĩa thì lượt đó coi như chưa hỏi.

Một vòng lấy response gồm bốn bước, làm gọn trong đúng lượt hiện tại:

1. gửi request qua Herdr;
2. đợi agent chuyển sang trạng thái đã trả lời xong;
3. đọc output của agent;
4. parse thành package và ghi `.foreman/progress/<id>.md`.

Lệnh cho bước 2 và 3 lấy từ `herdr-guide`; đừng dựng từ trí nhớ.

Hỏi nhiều worker thì **gửi hết request trước, rồi mới đợi lần lượt**.
Gửi–đợi–gửi–đợi làm thời gian cộng dồn, và Human đang chờ đúng một lượt.

### Trần đợi

Đợi đúng một lần mỗi worker mỗi lượt, trần khoảng hai phút.
Agent đang `working` sẽ xử lý request sau khi xong turn hiện tại, nên chạm trần là ca thường gặp, không phải sự cố.

Chạm trần thì dừng đợi và đi tiếp:

- giữ nguyên lifecycle và giữ nguyên `UPDATED` của snapshot cũ;
- không gửi lại request thứ hai trong cùng lượt;
- không tăng `↻N`, không ghi dòng nào vào `log.md`;
- **không kết luận worker chết và không requeue** — chậm trả lời và mất session là hai thứ khác nhau, chỉ bảng `## Đối chiếu thực tế` trong `SKILL.md` mới kết luận được điều thứ hai.

Lượt sau Human hỏi lại thì hỏi lại worker, vẫn một lần.

### Output không parse được

Đọc được output nhưng không dựng được package hợp lệ thì xử lý y như chạm trần, và nêu thêm là output không đúng mẫu.
Không tự suy ra field còn thiếu từ chữ trong transcript.

### Báo Human thế nào

Không bao giờ trình snapshot cũ như response vừa lấy.
Item chưa có response mới trong lượt này phải nói rõ cả hai mốc thời gian:

```markdown
`T-21` · Đang chạy · @codex-1

Chưa có cập nhật mới: đã hỏi lúc 15:42 nhưng worker chưa trả lời trong lượt này.
Snapshot gần nhất: 14:20.
Theo @codex-1: đã tái hiện callback trùng; đang thêm idempotency guard; tiếp theo chạy regression test.
```

Mọi item trong một status refresh đều chưa trả lời thì nói thẳng là chưa lấy được gì mới, đừng gói snapshot cũ thành một bản tóm tắt nghe như vừa cập nhật.

### Progress về đường nào

Progress trả lời **inline** qua output của agent; Foreman đọc rồi tự ghi snapshot.
`.foreman/inbox/` chỉ dành cho report durable lúc `done` hoặc `blocked`, đúng như contract trong mẫu prompt.

## Áp inbox

Mỗi worker chỉ được ghi `.foreman/inbox/<id>--<agent>.md` của assignment nó giữ; `<agent>` bỏ ký tự `@`.
File có format:

```text
TASK: T-22
AGENT: @codex-2
TYPE: blocked | done

<Decision hoặc Completion Package nguyên văn>
```

Áp một file theo thứ tự:

1. kiểm tra filename, `TASK` và `AGENT` cùng trỏ tới assignment owner hiện tại;
2. parse package, ghi `.foreman/progress/<id>.md`;
3. cập nhật lifecycle theo luật dưới;
4. chỉ sau khi cả hai bước ghi thành công mới xoá inbox file.

`TYPE: progress` không nằm trong contract của worker, vì progress đi inline theo `## Lấy response`.
File như vậy vẫn áp được: ghi snapshot, giữ `[~]`, không báo `bad-inbox`.
`done` chỉ đưa sang `[v]` khi Completion Package có changes, verification, affected files, public contract impact và known risks; thiếu field thì hỏi worker bổ sung và giữ `[~]`.
`blocked` không tự động thành `[?]`: nạp `blockers.md` và triage.
Không bao giờ đặt `[x]` từ inbox.

File sai format, id không tồn tại hoặc agent không còn là owner không được áp: báo `Bất thường`, ghi một dòng `bad-inbox` theo `bookkeeping.md`, rồi xoá file để sự kiện không lặp và không chặn report hợp lệ.
Nếu current owner còn sống, yêu cầu nó ghi lại package đầy đủ vào expected path.

## Cấm

- Không gửi lại cùng một operational request lần thứ hai trong một lượt.
- Không coi worker chưa trả lời kịp trong lượt là worker chết, và không requeue vì chạm trần đợi.
- Không trình snapshot cũ mà không nói rõ là chưa có response mới trong lượt này.
- Không suy ra field còn thiếu từ transcript thay vì hỏi lại worker ở lượt sau.
- Không đặt `[x]` hay `[?]` từ một file inbox.
