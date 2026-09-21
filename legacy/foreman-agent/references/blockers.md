# Blocker, decision và worker chết

Playbook của `foreman-agent`.
Nạp khi worker báo blocked, runtime là `blocked`, agent biến mất, hoặc Human vừa đưa một decision.

Mẫu prompt gửi worker nằm ở `assigning.md`; file này sở hữu **quyết định làm gì với blocker**.

## Triage blocker

Worker báo blocker chưa đủ để hỏi Human.
Trước hết yêu cầu worker xác định:

```text
- blocker do thay đổi hiện tại gây ra, do state có sẵn của repo, hay do thiếu authority;
- evidence đã kiểm tra;
- có thể giải quyết mà không đổi intended behavior không;
- next action nếu tự xử lý được.
```

### Nhánh worker tự gỡ được

Worker xác định giải pháp nằm trong task scope và không đổi intended behavior:

1. giữ `[~]`;
2. yêu cầu worker tự xử lý và tiếp tục;
3. cập nhật snapshot với `BLOCKER: tự xử lý — <blocker và cách gỡ, một câu>`;
4. không hỏi Human và không ghi `blocked`.

Dòng `tự xử lý` là thứ duy nhất đưa item vào nhóm `Đang tự xử lý` của báo cáo.
Không có nó thì blocker biến mất khỏi mọi report, và Human chỉ thấy một task tự dưng chạy lâu.
Snapshot kế tiếp không còn blocker thì bỏ hẳn tiền tố, không giữ lại như lịch sử.

### Nhánh cần Human

Có từ hai behavior hợp lệ trở lên, hoặc thiếu product, business, architecture, security, compatibility hay operational authority:

1. yêu cầu Decision Package nếu package hiện có chưa đủ;
2. lưu nguyên văn package vào snapshot;
3. chuyển sang `[?]`;
4. ghi đúng một dòng `blocked` theo `bookkeeping.md`;
5. trình Human option, impact, evidence và recommendation của worker.

Khi trình Human, dùng khối `## Decision package` trong `reporting.md`.
Đặt vấn đề và câu hỏi cần chọn lên trước, giữ mỗi option cùng impact của nó, và chỉ ghi nguồn một lần cho recommendation.
Không in lại schema field của worker hoặc các heading IN HOA.

Decision Package tối thiểu:

```text
GOAL
FINDING
WHY HUMAN DECISION IS REQUIRED
OPTIONS
IMPACT
EVIDENCE
RECOMMENDATION
```

Đây là phần **không được rút gọn**.
Luật độ dài trong `SKILL.md` áp cho phần operational; option, impact và recommendation là thứ Human đọc để quyết, nên giữ đủ.

## Human hỏi sâu và Human quyết

Human hỏi sâu hơn thì relay nguyên văn câu hỏi sang đúng worker, lấy response theo `worker-io.md`, rồi tóm tắt có nguồn.

Human quyết thì:

1. append nguyên văn decision vào backlog thành `↳`;
2. relay nguyên văn sang worker;
3. chuyển `[?]` về `[~]`;
4. cập nhật snapshot thành `working`.

Không tự chọn recommendation của worker.
Decision relay không tăng `↻N` và không ghi `followup`.

## Worker chết và handoff

Item `[~]` mà agent không còn tồn tại:

1. giữ nguyên progress snapshot gần nhất;
2. đưa item về `[ ]`, bỏ assignment và ghi dòng con agent cũ mất lúc nào;
3. ghi một dòng `requeue` theo `bookkeeping.md`;
4. tìm worker đủ điều kiện theo `assigning.md`;
5. nếu giao được không cần Human quyết, gửi Handoff Package ngay;
6. nếu chưa có worker, báo trong `Bất thường`, không bắt Human xử lý session chết.

Handoff Package gồm requirement gốc, decision đã chốt, snapshot gần nhất và chỉ thị:

```text
Inspect current repository state before continuing.
Do not assume the previous implementation is correct.
Verify existing changes, then continue toward the original goal.
Report overlap or unsafe partial state before editing further.
```

Worker cũ xuất hiện lại sau khi item đã giao người khác thì báo nó dừng task; backlog owner hiện tại thắng.

## Cấm

- Không escalate một blocker khi chưa yêu cầu worker triage.
- Không tự chọn giữa các option trong Decision Package, kể cả khi worker đã nêu recommendation.
- Không rút gọn option, impact hay recommendation khi trình Human.
- Không chuyển `[?]` về `[~]` khi chưa relay decision sang worker.
- Không kết luận worker chết chỉ vì nó chậm trả lời; điều kiện là agent không còn tồn tại trong runtime.
- Không giả định implementation của worker cũ là đúng khi handoff.
