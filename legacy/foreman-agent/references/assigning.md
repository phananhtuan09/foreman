# Giao việc

File tham chiếu của `foreman-agent`.
Đọc file này trước khi gửi bất cứ prompt nào cho worker agent.
File này sở hữu: dựng prompt, chọn agent, nhận quản lý worker đang chạy, soát lời người dùng, rà phụ thuộc, và tự giao việc tiếp.
Luật ghi friction nằm ở `bookkeeping.md`; luật lấy response nằm ở `worker-io.md`.

## Trình tự

1. Chọn item, rà dependency và overlap với `[~]` theo `## Điều phối phụ thuộc` ở cuối file này.
2. Tách nội dung khỏi địa chỉ, append nội dung mới vào backlog rồi lưu.
3. Dùng agent list đã lấy trong supervision cycle; chỉ list nếu lượt hiện tại chưa có snapshot runtime.
4. Chọn agent:
   - Human chỉ định thì dùng agent đó nếu hợp lệ;
   - không chỉ định thì lấy agent cùng repo, `idle` hoặc `done`, chưa giữ task;
   - nhiều agent general-purpose tương đương thì chọn tên tăng dần;
   - capability tạo khác biệt mà không có nguồn xác định thì hỏi Human một câu;
   - không có agent thì để `[ ]` và báo, không tự mở trong V3 core.
5. Agent chưa có tên thì đặt tên trước khi lưu assignment.
6. Dựng prompt từ backlog theo mẫu dưới và chạy `## Kiểm trước khi gửi`.
7. Gửi thẳng qua Herdr; không đi qua file trung gian.
8. Xác nhận agent nhận prompt rồi mới đổi `[~]`, ghi `@agent · YYYY-MM-DD HH:MM`, và tạo snapshot ban đầu; handoff thì đổi `AGENT/UPDATED` nhưng giữ last known progress đến response mới.
9. Xác nhận việc giao bằng một dòng theo `reporting.md`; chỉ in raw prompt khi Human yêu cầu xem prompt.

Agent `working` chỉ nhận task mới khi Human yêu cầu override.
Agent `blocked` chỉ nhận câu hỏi, context hoặc decision cho task nó đang giữ.

Nhận quản lý không phải giao task mới và không đi qua override này.

Không hỏi xác nhận trước khi gửi khi policy đã chọn được agent.
Câu hỏi ở bước kiểm hoặc capability ambiguity giải quyết thiếu authority; nó không phải câu hỏi xác nhận.

## Nhận quản lý worker đang chạy

Human có thể yêu cầu Foreman nhận quản lý một agent đã bắt đầu làm việc ngoài backlog.
Flow này chỉ áp dụng khi agent hiện là `working`; nó đăng ký ownership để observer theo dõi, không gửi lại yêu cầu công việc.

1. Dùng agent list của supervision cycle và xác nhận agent tồn tại, có `cwd` thuộc repo hiện tại, đang `working`, và chưa là owner của item `[~]` hoặc `[?]` khác.
2. Requirement phải đến từ một item `[ ]` đã có hoặc từ phần nội dung Human vừa cung cấp; nếu không có requirement đủ để lưu bền vững thì hỏi đúng một câu thay vì suy ra từ pane title hay transcript.
3. Nếu tạo item mới, ghi nguyên văn nội dung Human xuống backlog trước và soát theo luật bình thường.
4. Nếu agent chưa có tên, đặt tên ổn định trước khi ghi assignment.
5. Đổi item sang `[~]`, ghi `@agent · YYYY-MM-DD HH:MM`, rồi tạo snapshot ban đầu với field chưa biết là `-`, `CURRENT` nói worker đã chạy trước khi Foreman nhận ownership, và `COMPLETION STATE: working`.
6. Không gửi task prompt, Progress Package hay worker contract ở thời điểm nhận quản lý; worker đang làm đúng task đó và prompt mới có thể đến muộn rồi gây làm lặp.
7. Khởi động event observer theo `SKILL.md`; khi runtime rời `working`, reconcile và lấy package theo flow bình thường.

Agent khác repo, `unknown`, `blocked`, `idle` hoặc `done` không đi qua flow này.
Nếu agent đã ngừng chạy, báo trạng thái thật và xử lý bằng supervision flow phù hợp thay vì ghi một assignment giả là đang chạy.
Nếu agent đã giữ item khác, không đổi owner hoặc gộp hai task; báo mismatch để Human chỉ rõ task nào là đúng.

Xác nhận bằng đúng một dòng:

```text
Đã nhận quản lý T-14 từ @koken-1; observer đang theo dõi từ trạng thái hiện tại.
```

## Nguồn của khối YÊU CẦU

Câu người dùng gõ cho bạn luôn có hai phần, và chỉ một phần được đi tiếp:

| Phần | Người nhận thật | Xử lý |
| --- | --- | --- |
| **nội dung** — công việc worker phải làm | worker | xuống đĩa, rồi vào khối `YÊU CẦU` nguyên văn |
| **địa chỉ** — nói cho bạn biết gửi đi đâu, khi nào, theo thứ tự nào | bạn | không gửi |

Ranh giới giữa hai phần được xác định theo đúng một trong hai dạng dưới đây.
Không có dạng thứ ba, và bạn không được tự chế ra dạng nào khác.

### Dạng tường minh — người dùng bọc nội dung trong ngoặc kép

```text
giao việc này cho worker: "thêm rate limit cho /orders, dùng redis, 100 req/phút theo user"
```

Trong ngoặc là nội dung, gửi **nguyên văn**, không thêm không bớt.
Ngoài ngoặc là địa chỉ, **không gửi**, kể cả khi nó là một câu có nghĩa hoàn chỉnh.

Ranh giới nằm ở cặp ngoặc, không nằm ở phán đoán của bạn.
Người dùng đã tự tay vạch ranh giới rồi, nên ở dạng này bạn không còn gì để quyết.

Cặp ngoặc rỗng, hoặc mở mà không đóng, thì hỏi người dùng một câu, ghi `ambiguous`, và chưa gửi gì cả.
Đừng tự đoán ranh giới thay cho cặp ngoặc bị hỏng.

### Dạng mặc định — không có ngoặc kép

Khối `YÊU CẦU` dựng **hoàn toàn từ dòng backlog của item**: mô tả của nó, cộng mọi dòng con `↳` của nó.
Câu vừa gõ không đóng góp chữ nào vào prompt.

Câu đó có kèm nội dung công việc chưa nằm trên backlog thì append nguyên văn phần nội dung ấy vào item thành dòng con `↳ bạn nói <ngày>: …`, lưu file, rồi mới dựng prompt từ dòng backlog vừa cập nhật.

Phân vân một mệnh đề thuộc phần nào thì coi nó là **nội dung** và append vào `↳`.
Hai lỗi không cân nhau: append thừa một mệnh đề địa chỉ thì nó nằm trên dòng `↳`, người dùng nhìn thấy và xoá được; bỏ nhầm một câu công việc thì yêu cầu biến mất mà không ai biết.

### Mention không phải là tín hiệu

Nhắc tới `worker`, tên agent, hay id item **không** biến câu đó thành nội dung.
Đó là địa chỉ: nó nói cho bạn biết gửi *đi đâu*, không nói cho worker biết *phải làm gì*.

Gửi nguyên văn `giao T-01 cho worker codex` thì worker nhận đúng một câu vô nghĩa với nó: nó không có backlog, không biết `T-01` là gì, và không có thẩm quyền nào với việc giao việc.
Chỉ cặp ngoặc kép mới mở được cửa gửi nguyên văn cả câu.

### Hai dạng đều ghi trước, gửi sau

Nội dung phải nằm trên `backlog.md` **trước khi** đi sang worker, ở cả hai dạng.

Gửi thẳng từ câu vừa gõ thì nội dung ấy chỉ tồn tại trong hội thoại của bạn, và mất sạch ở lần clear session kế tiếp.
Ghi xuống đĩa trước cũng làm luật nguyên văn kiểm chứng được: prompt phải khớp dòng backlog, chứ không phải khớp một thứ chỉ mình bạn còn nhớ.

Người dùng nhờ giao một việc chưa có trên backlog thì tạo dòng `[ ]` cho nó trước theo luật ghi task ở `SKILL.md`, rồi mới giao.
Không giao một việc chưa có id.

Vẫn là **lọc chứ không sửa**:

- Được bỏ nguyên một mệnh đề thuộc phần địa chỉ.
- Không được đổi một chữ nào bên trong phần nội dung, kể cả sửa chính tả hay tách câu cho gọn.
- Không được gộp hai câu làm một, không được đổi thứ tự các câu.

## Kiểm trước khi gửi

Đọc lại prompt vừa dựng và trả lời đúng ba câu.
Ba câu này hỏi về **prompt**, không hỏi về codebase; không mở file nguồn nào để trả lời chúng.

| Câu hỏi | Dấu hiệu | Có thì làm gì |
| --- | --- | --- |
| Có chỗ nào chỉ hiểu được khi ngồi trong hội thoại của bạn với người dùng không? | "cái đó", "như hôm qua", "làm tiếp phần trên", "task trước" | hỏi người dùng một câu, ghi `ambiguous`, chưa gửi |
| Khối `YÊU CẦU` có chữ nào không có trên dòng backlog của item không? | "giao cho codex", "ưu tiên hơn T-11", hoặc bất cứ câu nào bạn chép từ hội thoại | dựng lại khối từ dòng backlog rồi gửi, không cần hỏi |
| Các dòng `↳` có chọi nhau không? | `↳` cũ nói dùng redis, `↳` mới nói dùng in-memory | hỏi người dùng một câu, ghi `ambiguous`, chưa gửi |

Dòng `↳` mới hơn **không** tự động thắng dòng cũ.
Tự chọn cái mới là bạn đang quyết thay người dùng, và worker sẽ không bao giờ biết là vừa có một lựa chọn bị bỏ đi.

Ba câu này là phần **chặn gửi**.
Những thứ soát ra mà không chặn — sai chính tả, trùng item — thuộc `## Soát lời người dùng` ở cuối file này: nêu một dòng rồi vẫn gửi bình thường.

Ba câu này thay cho việc bạn tự đọc hiểu task.
Bạn không có context repo còn worker thì có, nên hiểu task là việc của worker, và mẫu prompt đã mở sẵn cửa cho nó dừng lại báo `blocked` khi yêu cầu không đủ rõ.

## Mẫu prompt

Chép mô tả và mọi dòng `↳` chứa lời Human hoặc decision **nguyên văn**.
Không đưa progress, friction hoặc lời Foreman suy diễn vào `YÊU CẦU`.
Thay mọi id, agent name và report path trong mẫu bằng assignment thật.

Mẫu này đã nén: `LUẬT` và `REPORT` giống hệt nhau ở mọi lần giao, nên chúng viết ở mức ngắn nhất còn đủ nghĩa.
Không nở chúng ra thành câu đầy đủ hay thêm placeholder mô tả cho từng field; tên field đã đủ rõ với một coding agent.

```text
TASK: T-14 · report file: .foreman/inbox/T-14--codex-1.md

YÊU CẦU (nguyên văn của Human, không diễn giải lại)
> Thêm rate limit cho /orders
> dùng redis, 100 req/phút theo user

Foreman ghi chú (con trỏ, không phải yêu cầu)
- middleware hiện có: lib/http/limit.js

LUẬT
Giữ deep context của task: investigate, implement, chạy proof phù hợp với thay đổi.
Tự xử lý technical issue nằm trong scope và không đổi intended behavior; sửa thứ hỏng do chính thay đổi của bạn vẫn trong scope.
Nhiều behavior hợp lệ, hoặc thiếu product/business/architecture/security/compatibility authority → báo blocker cho Foreman, không hỏi Human trực tiếp.
Yêu cầu mơ hồ thì investigate phần xác định được rồi báo blocker, không tự chọn semantics.
Không mở rộng ngoài YÊU CẦU, không tự đổi lifecycle, không tự duyệt task.
Không đọc hay sửa `.foreman/`, ngoài việc ghi đè đúng file `.foreman/inbox/T-14--codex-1.md`.
Không commit hay push trừ khi YÊU CẦU nói làm; được phép thì chỉ stage đúng file bạn sửa, cấm `git add -A` và `git add .`.
Không đẩy task sang agent Herdr khác; sub-agent nội bộ trong phiên được phép.
Foreman hỏi thì trả lời ngắn, có cấu trúc, kèm evidence.

REPORT
Khi complete hoặc blocked, ghi đè toàn bộ file report trên bằng đúng một package, mở đầu bằng TASK / AGENT / TYPE:
done    → CHANGES, OBSERVABLE RESULT, VERIFICATION (ghi rõ cái chưa chạy), AFFECTED FILES, PUBLIC CONTRACT IMPACT, KNOWN RISKS, COMPLETION STATE
blocked → BLOCKER, INVESTIGATION, CAN RESOLVE WITHIN SCOPE, WHY HUMAN DECISION IS REQUIRED, OPTIONS, IMPACT, EVIDENCE, RECOMMENDATION, COMPLETION STATE
Không append vào file dùng chung. Không ghi report thiếu TASK, AGENT hoặc TYPE.
```

Prompt tự chứa; worker không cần đọc backlog hoặc progress.
`YÊU CẦU` thắng nếu chọi với mặc định trong `LUẬT`.
Dòng `TASK: <id> ` mở đầu là bắt buộc để ghim transcript.

### Foreman ghi chú

Khối này chỉ chứa **con trỏ**: một dòng nói cho worker biết tự tìm chi tiết ở đâu.
Tối đa ba dòng, mỗi dòng một câu.

Con trỏ đúng là đường dẫn file, id của task liên quan, hoặc một decision đã chốt.
Không phải con trỏ: chép lại findings, danh sách gap, hay bất cứ đoạn nào của một package mà chính worker đã tự viết ra.

Người nhận vừa là tác giả của thông tin đó thì càng phải trỏ chứ không chép.
Giao một task tiếp nối T-35 cho đúng agent đã làm T-35 thì viết:

```text
- tiếp nối T-35 bạn vừa làm; findings nằm trong Completion Package của chính bạn
```

Không có con trỏ thật thì bỏ hẳn khối, đừng để lại một khối rỗng hay một dòng chung chung.

## Operational requests
Các request dưới đây không đổi requirement. Status, triage, clarification, question, decision và handoff không tăng `↻N` hay ghi `followup`; rejection áp đúng luật `rejected` trong `bookkeeping.md`.

Worker trả lời các request này **inline** trong phiên của nó, không ghi vào `.foreman/inbox/`.
Foreman đọc response và xử lý ca chưa trả lời theo `worker-io.md`.

### Progress

```text
TASK: T-14 · progress request
Reply with exactly:
LAST: <last completed action>
CURRENT: <current action>
NEXT: <next action>
BLOCKER: <none or specific blocker>
PROOF: <performed proof and result; distinguish not run>
COMPLETION STATE: working | blocked | complete
AFFECTED FILES: <known paths or ->
```

### Triage technical blocker

```text
TASK: T-14 · blocker triage
Determine whether the blocker was introduced by this task, already existed, or requires missing authority.
Investigate first. Resolve and continue autonomously if it stays within scope and does not change intended behavior.
Otherwise return a Decision Package: GOAL, FINDING, WHY HUMAN DECISION IS REQUIRED, OPTIONS, IMPACT, EVIDENCE, RECOMMENDATION.
```

### Completion clarification

```text
TASK: T-14 · completion clarification
Provide CHANGES, OBSERVABLE RESULT, VERIFICATION, AFFECTED FILES, PUBLIC CONTRACT IMPACT, KNOWN RISKS, and COMPLETION STATE.
```

### Human question

```text
TASK: T-14 · Human question
<nguyên văn câu hỏi>
Answer from current code/task context with concise evidence. Do not change scope.
```

### Human decision

```text
TASK: T-14 · Human decision
<nguyên văn decision>
Continue within that decision and the original requirement.
```

### Handoff

```text
TASK: T-14 · handoff

ORIGINAL REQUIREMENT
<nguyên văn từ backlog>

HUMAN DECISIONS
<nguyên văn hoặc none>

LAST KNOWN PROGRESS
<snapshot>

Inspect current repository state before continuing.
Do not assume the previous implementation is correct.
Verify existing changes, then continue toward the original goal.
Report overlap or unsafe partial state before editing further.
```

### Rejection

```text
TASK: T-14 · rejection
Human rejected the submitted result:
<nguyên văn lý do>
Address this reason, re-verify the task, and return a new Completion Package.
```

## Requirement follow-up

Chỉ Human bổ sung hoặc đổi nội dung công việc mới là requirement follow-up.
Tách nội dung khỏi địa chỉ, append nguyên văn thành `↳ bạn nói <ngày>: …`, lưu backlog, rồi gửi đúng nội dung đó.

```text
TASK: T-12 · requirement follow-up
Có migrate data cũ. Viết migration script kèm rollback.
```

Requirement follow-up tăng `↻N` và ghi `followup`.
Decision relay, status request, blocker triage, completion clarification, Human question và handoff không tăng `↻N`.

## Soát lời người dùng

Người dùng gõ nhanh vì đang bận nghĩ việc khác, nên lỗi của chính họ là một nguồn rework thật.
Bạn soát giúp họ ở đúng hai thời điểm: khi ghi hoặc sửa một task hoặc issue trong `backlog.md` — kể cả khi chỉ append một dòng `↳` — và ngay trước khi gửi prompt cho worker.

Bạn soát **lời họ viết**, không soát **việc họ muốn**.
Task có đúng kỹ thuật không, có khả thi không, có đáng làm không — bạn không biết và không được đoán, vì bạn không có context repo.

Chỉ soát bằng thứ có sẵn: chính câu vừa gõ, dòng backlog của item, và các dòng `↳` của nó.
Không grep code, không mở file nguồn, không đọc `git log`.

Bốn thứ được phép nêu:

| Loại | Ví dụ |
| --- | --- |
| sai chính tả hoặc gõ nhầm | `reids` trong khi mọi dòng khác đều ghi `redis` |
| mâu thuẫn với chính nó hoặc với một dòng `↳` đã có | `↳` cũ chốt redis, câu mới nói in-memory |
| trùng một item đã có trên backlog | dòng mới lặp lại gần đúng mô tả của `T-11` |
| trỏ tới thứ không tồn tại | `— chờ T-99` mà không có `T-99`, hoặc "sửa lại phần đó" mà trên đĩa không có tham chiếu nào |

### Nêu thế nào

Không sửa gì cả.
Nguyên văn vẫn là luật: bạn nêu để người dùng tự sửa, không phải để sửa hộ.

Mỗi lần nêu phải **trích được đúng đoạn chữ** đang có vấn đề.
Trích được thì nêu một dòng; không trích được thì im lặng.

Không có gì để nêu thì không nói gì cả.
Không báo "đã soát, không có vấn đề": một dòng như vậy lặp ở mọi lượt sẽ dạy người dùng bỏ qua cả những lần nêu thật.

```text
Soát T-15: "reids" — có phải "redis" không?
Soát T-15: câu mới nói in-memory, còn ↳ 2026-08-11 đã chốt redis.
Soát T-16: trùng nhiều với T-11 "Thêm rate limit cho /orders".
```

### Nêu xong thì đi tiếp thế nào

| Đang làm gì | Loại vừa nêu | Xử lý |
| --- | --- | --- |
| ghi vào `backlog.md` | mọi loại | **vẫn ghi nguyên văn**, in dòng soát kèm theo, không hỏi |
| gửi prompt cho worker | chính tả, trùng | **vẫn gửi**, in dòng soát kèm theo |
| gửi prompt cho worker | mâu thuẫn, trỏ sai | dừng, hỏi một câu, ghi `ambiguous`, chưa gửi |

Lúc ghi backlog thì không bao giờ dừng lại hỏi.
Một dòng backlog sai thì người dùng nhìn thấy ngay và sửa được; một prompt sai thì đã tốn một vòng worker và một nấc `↻N`.

Soát không phải là một loại friction.
Không thêm dòng nào vào `log.md` cho việc soát, trừ đúng ca `ambiguous` đã có ở trên.

## Điều phối phụ thuộc

Phụ thuộc viết ngay trong mô tả: `— chờ T-12`, dùng chung cú pháp cho task và issue.
Không giao item đang `— chờ T-12` cho tới khi `T-12` đã được Human duyệt và có trong `done.md`.
Human ép giao thì cảnh báo rồi vẫn giao, và ghi một dòng `override`.

Item vừa được duyệt thì báo và xét tự giao những item nó vừa mở khoá.

### Rà phụ thuộc

Repo không có worktree, nên nhiều worker chạy cùng lúc dùng chung một cây làm việc.
Vì vậy "B phải chạy sau A" và "B đụng cùng vùng với A" dẫn tới cùng một hành động: xếp nối tiếp.
Một cú pháp `— chờ` là đủ cho cả hai; không thêm loại phụ thuộc nào khác.

Suy luận từ text đã có trên đĩa: mô tả, các dòng `↳`, dependency đã chốt, và affected files worker đã khai trong progress snapshot.
Không grep code, đọc `git log`, mở file nguồn hoặc tự đoán vùng chạm.

Rà ở ba thời điểm:

| Khi nào | Rà cái gì |
| --- | --- |
| Human hỏi thẳng | mọi `[ ]` với nhau và với `[~]` |
| ngay trước khi giao | item đó với các `[~]` |
| worker report affected files mới | item đó với các `[~]` khác |

Không query worker chỉ để rà toàn backlog.
Nếu package hiện có nêu affected files trùng nhau, đó là lý do cụ thể để cảnh báo.

Kết quả rà là **đề xuất**, không phải kết luận:

```markdown
### Đề xuất xếp nối tiếp

- `T-16` chờ `T-14` — Cả hai đều sửa middleware của `/orders`.
- `T-18` chờ `T-12` — `T-18` đọc schema orders mà `T-12` đang đổi.

Giao song song được: `T-15`, `T-17`, `B-06`.
```

Người dùng xác nhận phụ thuộc nào thì ghi `— chờ T-XX` vào mô tả của item chờ.
Không xác nhận thì không ghi gì, kể cả khi bạn tin là mình đúng.
Ghi `— chờ` là thêm một field của format, không phải biên tập lời người dùng, nên không vướng luật cấm sửa mô tả.

Nhánh "giao song song được" không ghi xuống đâu cả.
Nó suy ra lại được từ backlog bất cứ lúc nào, và lưu nó xuống chỉ tạo thêm state phải bảo trì.

Lúc giao mà thấy item có vẻ đụng vùng với một item `[~]`, cảnh báo **kèm lý do cụ thể**:

```text
T-16 có vẻ đụng vùng với T-14 (@codex-1, đang chạy): cả hai đều sửa middleware của /orders.
```

Người dùng xác nhận thì gửi, và ghi một dòng `override` vào `log.md`.

Một item có commit, push, hay tạo/sửa PR thì đụng **mọi** item `[~]`, không phải đoán vùng chạm gì cả: nó đóng gói cả cây làm việc mà mọi worker đang dùng chung.

```text
T-20 sẽ commit cả cây làm việc, mà T-14 (@codex-1) và T-16 (@claude-2) đang sửa dở trên đó.
```

Đây là ca duy nhất mà lý do đụng vùng là chắc chắn chứ không phải suy đoán, nhưng nó vẫn là đề xuất và người dùng vẫn là người chốt như mọi lần.

Không có lý do cụ thể thì đừng cảnh báo, cứ gửi.
Một câu chung chung lặp ở mọi lần giao song song sẽ bị bấm qua theo phản xạ, và `override` mất hết ý nghĩa của nó.

## Tự giao việc tiếp

Sau khi Human duyệt hoặc một worker được giải phóng, xét item `[ ]` đầu tiên theo thứ tự backlog.
Chỉ tự giao khi:

- dependency đã hoàn thành;
- không có overlap cụ thể với item `[~]`;
- có agent `idle` hoặc `done` cùng repo và chưa giữ task;
- yêu cầu không đòi capability mà Foreman không có nguồn để xác định.

Human chỉ định agent thì dùng agent đó.
Nếu nhiều agent general-purpose tương đương, chọn theo tên agent tăng dần để kết quả deterministic.
Nếu lựa chọn agent materially khác nhau vì capability hoặc topology, hỏi Human một câu.
Không tự mở agent mới trong V3 core.

## Cấm

- Không dựng khối `YÊU CẦU` từ câu người dùng vừa gõ; nguồn duy nhất của nó là dòng backlog của item.
- Không gửi sang worker phần lời mà người dùng đang nói với riêng bạn; bỏ nguyên mệnh đề đó, nhưng không sửa chữ nào trong phần đã giữ.
- Không coi việc người dùng nhắc tới `worker`, tên agent, hay id là tín hiệu gửi nguyên văn cả câu; chỉ cặp ngoặc kép mới mở cửa đó.
- Không nêu một điểm soát mà không trích được đúng đoạn chữ có vấn đề, và không báo rằng đã soát khi không có gì để nêu.
- Không để một điểm soát chặn việc ghi backlog; chỉ mâu thuẫn và trỏ sai mới chặn việc gửi.
- Không tự ghi `— chờ` khi Human chưa xác nhận, và không cảnh báo overlap khi không nêu được lý do cụ thể.
- Không giao một việc chưa có id trên backlog.
- Không gửi lại requirement hoặc worker contract khi nhận quản lý một worker đang `working`.
- Không chép nội dung package của worker vào `Foreman ghi chú`; khối đó chỉ chứa con trỏ.
- Không nở `LUẬT` hay `REPORT` ra dài hơn mẫu, và không thêm placeholder mô tả cho từng field.
