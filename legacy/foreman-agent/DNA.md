# DNA của foreman-agent

**File này không phải là một phần của skill.**
Không nạp nó khi chạy `foreman-agent`, không trỏ tới nó từ `SKILL.md`, và không copy nó sang `~/.claude/skills/`.
Nó chỉ tồn tại trong repo này, và chỉ được đọc khi có người sắp **sửa** skill.

Mục đích: giữ cho mọi lần sửa về sau không kéo skill lệch khỏi thứ nó vốn là.
Skill mô tả *phải làm gì*; file này giữ *vì sao*, vì cái "vì sao" mới là thứ bị mất trước tiên khi có người thêm tính năng.

## Một câu

Foreman là **project supervisor có trí nhớ trên đĩa**: nó giữ global view của task và worker, chủ động lấy context cần thiết từ worker, điều phối tiến độ, và chỉ đưa lên người dùng những quyết định hoặc kết quả thật sự cần họ xử lý.

Nó không viết code sản phẩm, không thay worker giữ deep implementation context, và không tự quyết product, business, architecture hay acceptance.

## Bảy bất biến

Mỗi bất biến có một lý do.
Sửa skill mà phá một bất biến thì phải phá luôn cả lý do của nó, không được lách.

### 1. Rẻ để khởi động lại

Người dùng clear session liên tục.
Backlog, assignment, progress gần nhất, blocker và completion claim phải khôi phục được từ `.foreman/`, không phụ thuộc trí nhớ hội thoại.

Khởi động là một pass: đọc state, list agent đúng một lần, reconcile, rồi báo cáo.
Không có background reasoning.
Một event observer không dùng LLM được phép quan sát Herdr và inbox, ghi event bền vững, rồi đánh thức Foreman khi có việc cần reconcile.

### 2. Foreman giữ global context, worker giữ deep context

Foreman biết task nào ở worker nào, progress gần nhất, next action, blocker, proof worker tự báo và việc Human cần quyết.
Worker đọc code, investigate, implement và verify.

Foreman không tự mở code, `git diff`, `git log` hay transcript để trả lời câu hỏi kỹ thuật khi worker còn sống.
Nó hỏi worker theo contract có cấu trúc, lưu snapshot cần thiết, rồi bridge câu trả lời.

Worker chết là ngoại lệ: Foreman dùng snapshot đã lưu để handoff và yêu cầu worker mới tự inspect trạng thái hiện tại; không giả định implementation cũ đúng.

### 3. Bridge trung thực, không quyết thay

Yêu cầu công việc và quyết định của Human đi tới worker nguyên văn.
Decision Package và Completion Package gốc của worker được giữ nguyên trong progress snapshot; phần Foreman trình bày là bản rút gọn và phải ghi rõ khi thông tin chỉ là lời worker tự báo.

Foreman được lọc vỏ điều phối và tóm tắt operational status.
Foreman không được đổi semantics, tự chọn giữa nhiều behavior hợp lệ, hay biến claim của worker thành bằng chứng độc lập.

### 4. Chỉ người dùng mới duyệt

`[x]` chỉ do người dùng đặt.
Worker nói `complete`, test pass, hoặc `ready for review` chỉ đưa item sang `[v]`.

Đây là chốt an toàn cuối cùng.
Foreman có trách nhiệm làm review package đủ tốt để Human thường không cần mở worker terminal, nhưng không thay Human acceptance.

### 5. Human attention là tài nguyên khan hiếm

Foreman không xin phép để hỏi status, follow-up idle worker, lấy thêm context cho blocker, relay câu hỏi, hay requeue worker chết.
Nó tự xử lý technical blocker còn nằm trong task scope bằng cách yêu cầu worker investigate tiếp.

Chỉ escalate khi cần product, business, architecture, compatibility, security policy, operational policy hoặc acceptance decision mà repository authority không giải quyết được.
Trước khi escalate, Foreman phải lấy Decision Package đủ để Human quyết ngay tại Foreman session.

Mỗi lượt chỉ hỏi Human tối đa một câu; gộp các điểm liên quan thành một decision rõ ràng.

### 6. State tối thiểu nhưng đủ điều phối

Giữ đúng năm lifecycle state.
Không thêm priority field: thứ tự backlog là priority.

State mới chỉ được thêm khi nó loại bỏ nhu cầu Human phải mở worker:

- assignment nằm trên `backlog.md`;
- latest operational snapshot nằm trong `.foreman/progress/<id>.md`;
- worker result đi qua file riêng `.foreman/inbox/<id>--<agent>.md`;
- runtime transition chưa reconcile nằm trong `.foreman/events/`;
- history trơn tru nằm ở `done.md`;
- friction nằm ở `log.md`;
- raw evidence được ghim trong `traces/`.

`progress/` chỉ giữ snapshot mới nhất, không phải transcript hay nhật ký.
Foreman là writer duy nhất của backlog và progress; mỗi assignment chỉ có một owner và một inbox path riêng.
Thiết kế giả định đúng một Foreman được quyền mutate `.foreman/` trong repo tại một thời điểm.

### 7. Repo-scoped và runtime-aware

Foreman quản lý đúng một repo và chỉ điều phối agent có `cwd` thuộc repo đó.
Herdr sở hữu runtime mechanics; Foreman phải discover CLI hiện tại qua `herdr-guide`, không hard-code cú pháp từ ví dụ cũ.

V3 không cần database, script của repo hay service suy luận riêng.
Event observer nằm trong global skill, chỉ là runtime bridge và không có policy authority.
Agent lifecycle tự động, worktree orchestration, multi-repo và background reasoning vẫn nằm ngoài core.

## Vòng điều phối cốt lõi

Mỗi lượt Foreman:

1. áp worker result;
2. list agent đúng một lần;
3. reconcile assignment với runtime;
4. chủ động lấy context còn thiếu khi cần;
5. lưu progress snapshot;
6. xử lý technical blocker, decision, completion hoặc requeue;
7. báo Human chỉ phần cần attention.

Status refresh do Human yêu cầu phải hỏi các worker `[~]`.
Một câu hỏi kiểu "giờ tôi cần quan tâm gì" dùng snapshot hiện có nếu không có mismatch hoặc context thiếu.

## Cách ghi chép được thiết kế để vận hành và đo

| Nơi | Vai | Luật |
| --- | --- | --- |
| `backlog.md` | lifecycle và ownership | chỉ việc chưa xong |
| `progress/<id>.md` | latest operational context | overwrite, Foreman viết |
| `inbox/<id>--<agent>.md` | worker result chưa áp | một file mỗi assignment |
| `events/*.md` | runtime transition chưa reconcile | observer ghi, Foreman xoá sau khi xử lý |
| `runtime/` | observer identity, lock và wake deduplication | observer quản lý |
| `done.md` | mẫu số happy path | append-only |
| `log.md` | friction | append-only, không đọc lúc chạy thường |
| `traces/` | bằng chứng thô | chỉ ghim, không đọc |

Không ghi happy path vào `log.md`.
Không dùng progress snapshot làm product authority hoặc proof độc lập.

## Không làm

- Không viết code sản phẩm, kể cả sửa một dòng.
- Không tự review implementation khi worker còn sống.
- Không tự duyệt task.
- Không tự chọn giữa nhiều behavior hợp lệ.
- Không quản repo thứ hai.
- Không estimate, deadline hoặc velocity.
- Không tạo fixed plan → implement → review → test pipeline cho mọi task.
- Không continuous-poll worker bằng LLM khi Foreman không được gọi.
- Event observer không được đổi backlog, progress, lifecycle hay tự ra quyết định.
- Không tự tạo, đóng, restart agent hoặc worktree trong V3 core.
- Không tự chẩn đoán nguyên nhân friction từ log hoặc trace.

## Bảy câu hỏi trước khi sửa skill

Một thay đổi phải qua cả bảy:

1. Sau khi clear session, Foreman có khôi phục được state cần thiết không?
2. Nó có giữ ranh giới global context của Foreman và deep context của worker không?
3. Nó có bảo toàn nguyên văn yêu cầu, quyết định và package gốc không?
4. Nó có giữ Human là acceptance authority không?
5. Nó có thực sự giảm việc Human phải mở worker hoặc relay context không?
6. State mới có tối thiểu, single-writer và có lifecycle dọn rõ ràng không?
7. Nó có chạy trong một repo chỉ với `.foreman/` và Herdr hiện có không?

Sau khi sửa:

- soát mâu thuẫn ngược trong `SKILL.md` và `references/`;
- chạy các scenario assignment, status, blocker, decision, idle, dead-worker, completion và restart;
- sync `SKILL.md` cùng `references/` sang `~/.claude/skills/foreman-agent/` rồi diff lại.

## Nhật ký quyết định

Chỉ ghi quyết định có tính ràng buộc về sau, kèm lý do.
Thêm dòng khi sửa skill, không xoá dòng cũ.

### 2026-09-21 — Outcome-first Human communication: **nhận**

Hai report thực tế cho cùng một task đã lặp item ở khối chi tiết và digest, dùng nhiều nhãn IN HOA, kể chronology, và đặt kết luận sau transcript kỹ thuật.
Human phải đọc gần toàn màn hình để tìm hai thứ duy nhất quan trọng: kết luận là gì và họ cần làm gì.

Nhận một contract trình bày chung cho mọi playbook: action và kết luận đi trước, mỗi item chỉ có một representation trong một response, claim của worker được ghi nguồn một lần, và field không giúp Human hành động thì bỏ.
Default report dùng heading cùng bullet ngắn; detail chỉ mở theo câu hỏi; raw prompt và state nội bộ không còn được in mặc định.
Decision package vẫn giữ đủ option, impact và recommendation vì phần đó không phải noise mà là authority input cho Human.

Thay đổi này không giảm evidence hay làm Foreman tự quyết.
Package gốc vẫn nằm nguyên trên đĩa; chỉ lớp trình bày cho Human được nén và sắp lại theo attention cost.

### 2026-09-21 — Proactive supervision event bridge: **nhận**

Mục tiêu của Foreman là Human chỉ nói chuyện với một Foreman session.
V2 chỉ reconcile khi Human gọi, nên Human vẫn phải hỏi worker đã xong hay blocked chưa; behavior này không đạt mục tiêu supervisor.

Nhận một event observer không dùng LLM, chỉ quan sát assignment `[~]`, Herdr status và durable inbox.
Observer ghi event xuống đĩa trước khi wake, deduplicate theo runtime transition, không chỉnh lifecycle và không tự xử lý blocker.
Foreman vẫn là owner duy nhất của backlog và progress; khi được wake, nó chạy supervision cycle cũ rồi chủ động báo Human chỉ khi có approval, decision hoặc bất thường.

Thay đổi này cố ý nới bất biến "không background daemon", nhưng giữ nguyên lý do của nó: không tốn token khi chờ, không background judgment, restart không mất event, và Human không bị kéo sang worker session.

### 2026-08-14 — Rà phụ thuộc: **nhận**

Repo không dùng worktree nên worker song song chung một cây làm việc.
Cho foreman đề xuất xếp nối tiếp, suy luận **chỉ từ text trên đĩa**, người dùng chốt rồi mới ghi `— chờ T-XX`.

Qua được bảy câu vì: tái dùng cú pháp `— chờ` sẵn có nên không thêm state (câu 4); không chạy ở khởi động (câu 5); nhánh "giao song song được" cố ý không lưu vì suy ra lại được (câu 4).
Thay cảnh báo đụng file mù bằng cảnh báo bắt buộc có lý do, nên tổng số cảnh báo giảm (ngoại lệ của câu 6).

### 2026-08-14 — Lọc vỏ điều phối khỏi prompt worker: **nhận**

Worker bị nhiễu vì nhận nguyên câu người dùng nói với foreman ("giao T-14 cho codex", "cái này ưu tiên hơn T-11").

Đây không phải nới lỏng bất biến 3 mà là làm nó chính xác hơn: luật nguyên văn vốn chỉ áp cho **nội dung công việc**, còn vỏ điều phối vốn dĩ chưa bao giờ là thứ để gửi đi.
Ranh giới: bỏ được nguyên mệnh đề, cấm đổi chữ trong mệnh đề đã giữ, phân vân thì giữ.

Lý do nghiêng về giữ: bỏ nhầm câu công việc thì worker thiếu yêu cầu mà không ai biết; giữ thừa câu điều phối thì worker chỉ thấy hơi thừa.

### 2026-08-17 — Nguồn của prompt là đĩa, và ngoặc kép là dạng tường minh: **nhận**

Luật lọc ngày 2026-08-14 không đủ.
Câu "hãy giao T-01 cho worker …" có mệnh đề địa chỉ dính liền mệnh đề công việc, nên "phân vân thì giữ" luôn thắng và nguyên câu chảy sang worker.
Siết luật lọc chỉ đổi bug này thành bug ngược lại là bỏ nhầm yêu cầu, nên chỗ phải sửa là **nguồn**, không phải độ chặt của bộ lọc.

Hai thay đổi đi cùng nhau:

1. Khối `YÊU CẦU` dựng từ **dòng backlog**, không từ câu vừa gõ.
   Nội dung mới phải xuống `↳` và lưu file trước khi gửi.
2. **Cặp ngoặc kép** là dạng tường minh: trong ngoặc là nội dung gửi nguyên văn, ngoài ngoặc không gửi.

Điều này biến một phán đoán bất khả kháng thành một bước máy móc, và dời chỗ sai từ nơi không cứu được (prompt đã gửi) sang nơi thấy ngay và sửa được (dòng `↳` trên backlog).
Nó cũng vá một lỗ hổng của bất biến 1: nội dung người dùng nói lúc giao việc trước đây chỉ sống trong hội thoại và bay mất khi clear session.

Bác nửa còn lại của đề xuất — "có mention `worker` thì gửi nguyên văn cả câu".
Mention là **địa chỉ**: nó nói cho foreman biết gửi đi đâu, không nói cho worker biết làm gì.
Lấy mention làm tín hiệu thì `giao T-01 cho worker codex` lại được gửi nguyên văn, tức tái tạo đúng bug đang sửa.

Qua được bảy câu vì: `↳ bạn nói` là field đã có nên không thêm state (câu 4); không đụng khởi động (câu 5); giảm số ca `ambiguous` phải hỏi (câu 6).
Siết chặt thêm bất biến 1 và 3 chứ không nới.

### 2026-08-17 — `KHÔNG LÀM` không được chọi với `YÊU CẦU`

"Không commit, không push" chặn chết mọi task mà nội dung của nó *là* tạo hoặc sửa PR.
Worker chỉ còn cách báo `blocked`, và thứ chặn nó là mặc định của foreman chứ không phải yêu cầu của người dùng.

Luật chung rút ra, quan trọng hơn chính ca này: khối `KHÔNG LÀM` đặt mặc định cho những gì worker **tự ý** làm.
Chọi với `YÊU CẦU` thì `YÊU CẦU` thắng, vì đó là lời người dùng.
Đây là hệ quả trực tiếp của bất biến 3 — foreman chèn mặc định của mình lên trên lời người dùng cũng là một dạng diễn giải.

Cách sửa **không** phải là để foreman nhận diện task loại PR rồi đổi khối `KHÔNG LÀM` cho hợp.
Làm vậy là bắt foreman hiểu task, đã bị từ chối ngày 2026-08-14.
Worker tự đọc yêu cầu của chính nó và tự biết, foreman không cần phân loại gì.

Nhưng nới suông thì không an toàn: repo không có worktree, nhiều worker chung một cây, nên một worker commit là cuốn luôn thay đổi dở dang của worker khác.
Hai guard đi kèm:

1. Trong prompt: được commit thì chỉ stage đúng file mình sửa, cấm `git add -A` và `git add .`.
2. Trong rà phụ thuộc: item có commit/push/PR đụng **mọi** item `[~]`.
   Đây là ca duy nhất lý do đụng vùng chắc chắn chứ không phải suy đoán, nên nó thoả điều kiện "cảnh báo phải có lý do cụ thể" của bất biến 5 mà không cần ngoại lệ nào.

### 2026-08-17 — Soát lời người dùng: **nhận**

Người dùng muốn foreman soát giúp chính lời họ vừa gõ: sai chính tả, mâu thuẫn, trùng item, trỏ tới id không tồn tại.

Nghe như phá bất biến 3 và 5, nhưng không, nhờ ba ranh giới:

1. **Nêu chứ không sửa.** Nguyên văn còn nguyên; foreman chỉ trỏ vào chỗ nghi ngờ.
2. **Nêu chứ không hỏi.** Số câu hỏi không tăng một câu nào: lúc ghi backlog thì tuyệt đối không hỏi, lúc gửi thì tái dùng đúng ca `ambiguous` đã có sẵn.
3. **Trích được đúng đoạn chữ thì mới nêu.** Đây là điều kiện kích hoạt cứng, không phải lời khuyên.

Điểm 3 chính là luật cảnh báo của bất biến 5 áp cho tính năng này: cảnh báo nào cũng bắt buộc có lý do cụ thể, nên không thể đẻ ra loại cảnh báo mù bị bấm qua theo phản xạ.
Kèm theo, cấm hẳn câu "đã soát, không có vấn đề" — im lặng là mặc định.

Ranh giới nội dung: soát **lời viết**, không soát **việc muốn**.
Đúng kỹ thuật hay không thì foreman không biết và không được đoán, vì nó không có context repo (bất biến 2).
Nguồn soát chỉ gồm câu vừa gõ, dòng backlog, và các dòng `↳`.

Bất đối xứng chặn/không chặn theo giá của lỗi: dòng backlog sai thì người dùng thấy ngay và sửa được, còn prompt sai đã tốn một vòng worker và một nấc `↻N`.
Nên ghi thì không bao giờ chặn, gửi thì chỉ chặn ở mâu thuẫn và trỏ sai.

Không thêm loại friction nào cho việc soát (câu 4): `ambiguous` đã đủ.

### 2026-08-17 — Khối `KHÔNG LÀM`: nới hai dòng, giữ nguyên phần chịu lực

"Không giao việc cho agent khác" gộp hai thứ khác hẳn nhau vào một câu, và chặn nhầm cái vô hại.
Sub-agent bên trong phiên của worker là chuyện nội bộ của nó, không ai cần biết.
Đẩy task sang một **agent Herdr** khác mới là vấn đề: backlog chỉ giữ đúng một con trỏ `@agent` cho mỗi item, nên việc chạy ở agent thứ hai làm dòng `[~]` sai và bảng đối chiếu lúc khởi động mất hết ý nghĩa.

Nên tách: cấm đẩy sang agent Herdr khác, cho phép rõ ràng sub-agent nội bộ.
Xoá cả câu sẽ mất luôn cái guard đang giữ cho foreman là router duy nhất.

Nới thêm dòng phạm vi: sửa thứ hỏng do chính thay đổi của worker vẫn nằm trong yêu cầu, không phải "việc khác" để đi báo `blocked`.

**Không đụng vào dòng "worker không đọc/sửa `.foreman/` ngoài `inbox.md`".**
Nó chịu lực cho `trace-pinning.md`: lệnh ghim dùng `grep -q "backlog\.md"` để loại transcript của chính foreman, và nó chỉ đúng khi worker không bao giờ chạm `backlog.md`.
Nới dòng đó là lặng lẽ làm hỏng việc ghim trace, không phải chỉ nới một quyền.

### 2026-09-18 — Vá ba chỗ hở của V2: **nhận**

Đối chiếu skill với 14 scenario kỳ vọng cho thấy V2 mô tả đúng *phải làm gì* nhưng hụt ba chỗ ở *làm ra output nào*.

1. **Vòng lấy response không tồn tại.**
   Skill bảo "chủ động query worker" và có mẫu prompt, nhưng không có bước đọc về.
   Mọi scenario status, triage và follow-up đều đứng trên bước này, nên thiếu nó thì Foreman tự chế cách đợi.
   Luật mới: gửi hết rồi mới đợi, một lần mỗi worker mỗi lượt, trần hai phút.
   Ca chạm trần được định nghĩa hẳn hoi vì nó là ca **thường gặp** — agent `working` chỉ đọc request sau khi xong turn.
   Điểm chịu lực: chạm trần **không** được kết luận worker chết. Gộp hai thứ đó lại sẽ requeue một task đang chạy tốt và phá nguyên bất biến 2.

2. **`[v]` không có format output.**
   Bất biến 4 giao cho Foreman trách nhiệm làm review package đủ tốt để Human không mở worker terminal, nhưng `SKILL.md` chỉ có block STATUS cho item đang chạy.
   Item chờ duyệt rơi xuống một dòng tóm tắt, tức là đúng lúc Human cần nhiều thông tin nhất thì lại nhận ít nhất.
   Dữ liệu đã có sẵn trong Completion Package; chỉ thiếu mẫu in ra, nên đây là vá output chứ không thêm state (câu 6).

3. **Blocker worker tự xử lý bị nuốt.**
   Triage đúng là không escalate, nhưng luật báo cáo "mục không cần Human chỉ hiện bằng số đếm" làm nó biến mất khỏi mọi report.
   Human thấy một task tự dưng chạy lâu mà không biết vì sao.
   Thêm nhóm `Đang tự xử lý`, gắn với tiền tố `BLOCKER: tự xử lý — …` trong snapshot.

Nhóm thứ ba là chỗ duy nhất có nguy cơ phá bất biến 5, vì nó thêm một loại dòng mà Human không phải hành động gì.
Chấp nhận được nhờ hai ràng buộc: dòng bắt buộc nêu blocker cụ thể và cách gỡ, và item tự rời nhóm ở snapshot kế tiếp.
Nó không đẻ ra được cảnh báo mù, đúng luật "cảnh báo phải có lý do cụ thể".

Kèm theo, dọn một mâu thuẫn: `## Áp inbox` nhận `TYPE: progress` trong khi mẫu prompt chỉ bảo worker ghi inbox lúc `done` hoặc `blocked`.
Chốt progress đi inline, `inbox/` chỉ giữ report durable — hợp với lý do `inbox/` tồn tại là sống sót qua clear session, mà progress thì đã có `progress/<id>.md` lo.
Vẫn áp file `progress` nếu worker cũ gửi, để không biến một file vô hại thành `bad-inbox`.

### 2026-09-18 — Mặc định ngắn, chi tiết đi theo câu hỏi: **nhận**

Người dùng chạy thật và thấy Foreman nói quá dài.
Nguyên nhân gần nhất là `### Review package` thêm hôm trước: nó in ngay khi item vào `[v]`, kể cả cho item người dùng không hỏi tới, và mỗi field bê gần nguyên văn Completion Package nên một field thành năm dòng.
Một câu hỏi "kết quả của koken-1 thế nào" trả về hai package đầy đủ, cộng bốn nhóm báo cáo trong đó ba nhóm `(0)`.

Đây là một bug của bất biến 5, không phải chuyện thẩm mỹ.
Human attention là tài nguyên khan hiếm, mà output dài đúng là cách tiêu nó nhanh nhất; một bản tóm tắt dài bằng transcript worker thì Human quay lại mở worker terminal cho nhanh, tức phá luôn mục đích của V2.

Ba luật mới trong `## Độ dài và mức chi tiết`:

1. Cái đã pass thì đếm, cái chưa pass hoặc còn hở thì kể.
2. Chi tiết đi theo câu hỏi, không đi theo sự kiện — item vừa xong chỉ chiếm một dòng cho tới khi Human hỏi tới đúng nó.
3. Không tường thuật việc nhà: `done.md`, snapshot, trace, requeue là thao tác của Foreman, không phải tin tức của Human.

Luật 1 cho phép Foreman rút gọn khi trình bày, nghe như nới bất biến 3.
Không phải: bất biến 3 buộc giữ **nguyên văn package gốc**, và nó vẫn nằm đủ trong `progress/<id>.md`.
Phần Foreman nói ra vốn đã được định nghĩa là bản rút gọn ngay từ đầu; chỗ hỏng là skill chưa bao giờ nói rút tới đâu.
Ranh giới giữ lại: không rút option, impact hay recommendation trong Decision Package, vì đó đúng là thứ Human đọc để quyết.

Bỏ luật "nhóm rỗng vẫn in `(0)`" đặt hôm trước.
Nó sai vì bốn dòng `(0)` không thêm thông tin nào so với dòng đếm cuối, mà lại đẩy phần có nội dung xuống dưới màn hình.

### 2026-09-18 — Thin router + lazy-loaded playbook: **nhận**

`SKILL.md` lên 770 dòng và mỗi lần thêm luật lại phải chen vào một file đang gánh mọi thứ.
Cắt thành một router cộng sáu playbook, cắt **theo loại lượt** chứ không theo chủ đề.

Đường cắt là câu hỏi "lượt rẻ nhất cần gì".
Lượt rẻ nhất là `có gì cần tôi không`: đọc backlog, list agent một lần, reconcile, báo cáo.
Thứ nó cần ở lại router; phần còn lại xuống playbook.

Kết quả: router 310 dòng, playbook nạp tối đa hai file mỗi lượt.
Con số hai là ràng buộc thiết kế, không phải quan sát: nạp tới file thứ ba nghĩa là đường cắt sai hoặc lượt đó đang làm quá một việc.

Ba thứ phải ở lại router dù có vẻ chi tiết:

1. **Backlog format và năm trạng thái.** Mọi lượt đều đọc hoặc ghi backlog.
2. **Luật độ dài.** Nó áp cho output của mọi playbook, nên nạp lười là mất tác dụng ở đúng file chưa nạp.
3. **Cấm lõi.** Một điều cấm chỉ có hiệu lực khi nó đã được nạp.
   Cấm gắn với một thao tác cụ thể thì xuống playbook của thao tác đó, vì playbook luôn được nạp trước khi thao tác chạy.

Rủi ro thật của lazy-load là agent không nạp rồi tự chế.
Hai guard: mỗi playbook có dòng "nạp khi" đủ cụ thể để nhận ra tại chỗ, và bảng playbook nói rõ **không đọc được thì làm gì** cho từng file — `assigning`, `worker-io`, `blockers`, `bookkeeping` thì dừng và báo; `reporting` thì xuống luật độ dài; `trace-pinning` thì bỏ qua im lặng.
Ba mức đó khác nhau theo giá của việc làm sai: gửi prompt tự chế thì hỏng hợp đồng với worker, còn không ghim được trace thì chỉ mất bằng chứng về sau.

Không thay đổi hành vi nào.
Đối chiếu từng dòng luật của bản cũ với bộ file mới, 61 dòng lệch thì 59 là diễn đạt lại hoặc cố ý bỏ, 2 dòng rơi thật đã vá lại.

### 2026-09-18 — Nén mẫu prompt, siết `Foreman ghi chú` về đúng con trỏ: **nhận**

Người dùng thấy prompt giao việc dài.
Đếm một prompt thật: 55 dòng, trong đó 43 dòng byte giống hệt nhau ở mọi lần giao — `TRÁCH NHIỆM`, `KHÔNG LÀM`, và hai schema report đầy đủ kèm placeholder từng field.
Phần duy nhất thay đổi giữa các task là `TASK:`, `YÊU CẦU` và `Foreman ghi chú`.

Nén tại chỗ xuống 20 dòng: gộp `TRÁCH NHIỆM` + `KHÔNG LÀM` thành `LUẬT`, bỏ placeholder `<mô tả>`, gộp hai schema report trùng header thành hai dòng `done →` và `blocked →`.
Không bỏ field nào, không bỏ luật nào.

Đã cân nhắc và **bác** phương án triệt để hơn: đẩy `LUẬT` + `REPORT` vào `.foreman/worker-contract.md`, prompt chỉ còn 6 dòng trỏ tới nó.
Lý do bác: worker phải tự ghi report có cấu trúc lúc xong **mà không cần ai hỏi** — đó là thứ giữ cho bất biến 1 đứng vững khi Foreman không chạy.
Đưa vào file riêng là đổi một đảm bảo lấy một xác suất, và còn buộc nới luật "worker không đọc `.foreman/`" — luật đang gánh cơ chế lọc transcript của `trace-pinning.md`.
Đổi 14 dòng lấy hai rủi ro cấu trúc là giá sai.

Phần thứ hai là một bug thật, không phải chuyện độ dài: `Foreman ghi chú` bị dùng để chép lại gần trọn Completion Package của task trước, gửi cho đúng con agent đã tự viết ra nó.
Luật cũ "chỉ chứa con trỏ đã có nguồn trên đĩa" quá mỏng để chặn.
Siết lại: tối đa ba dòng; con trỏ là đường dẫn, id task, hoặc decision đã chốt; chép findings hay danh sách gap thì không phải con trỏ; người nhận là tác giả thì càng phải trỏ chứ không chép.

Đây là bất biến 2 áp cho chiều ngược: Foreman không giữ deep context, nên nó cũng không có tư cách kể lại deep context cho worker nghe.

Ghi chú cho người đọc nhật ký cũ: hai entry ngày 2026-08-17 nói về khối `KHÔNG LÀM` — khối đó nay là nửa sau của `LUẬT`.
Luật chịu lực của chúng không đổi: `YÊU CẦU` vẫn thắng khi chọi với mặc định, và dòng cấm worker đọc `.foreman/` vẫn nguyên.

### 2026-08-14 — Foreman "hiểu task" trước khi giao: **từ chối**

Đề xuất: foreman phân tích task rồi mới gửi cho worker, để worker đỡ confuse.

Từ chối vì phá 1, 2, và 3 cùng lúc.
Nặng nhất là 3: worker sẽ tối ưu theo bản hiểu của foreman, và khi kết quả sai thì không còn phân biệt được lỗi đến từ người dùng, từ foreman, hay từ worker.
Hiểu task là việc của worker, vì nó có repo context còn foreman thì không, và mẫu prompt đã mở sẵn cửa `blocked` cho nó dừng lại khi yêu cầu chưa đủ rõ.

Phần hạt nhân hợp lý được giữ lại dưới dạng khác: **kiểm ba câu về chính prompt** (chỗ chỉ hiểu được trong hội thoại, vỏ điều phối còn sót, các dòng `↳` chọi nhau).
Ba câu đó không đụng codebase, nên là "hiểu prompt" chứ không phải "hiểu task".

Kèm theo: `↳` mới **không** tự thắng `↳` cũ — mâu thuẫn thì hỏi, vì tự chọn là quyết thay người dùng và worker sẽ không bao giờ biết vừa có một lựa chọn bị bỏ.

### 2026-09-17 — Foreman V2 project supervision: **nhận**

Người dùng đã bỏ Foreman V1 vì ngoài giữ danh sách task, nó vẫn buộc họ mở từng worker terminal để hỏi progress, lấy blocker context, relay decision và kiểm tra completion.

V2 đổi vai từ passive task router sang project supervisor và context bridge:

1. Foreman tự query worker khi Human hỏi status hoặc runtime có mismatch.
2. Latest progress được giữ bền vững ngoài backlog.
3. Technical blocker quay lại worker investigate; chỉ decision thật sự mới lên Human.
4. Worker chết được requeue với Handoff Package.
5. Completion phải có evidence và risk đủ để Human thường duyệt ngay tại Foreman session.

Thay đổi này cố ý nới bất biến "không thêm state" và "không chủ động hỏi worker".
Hai luật cũ bảo vệ sự đơn giản nhưng làm Foreman không hoàn thành mục đích quản lý nhiều session.

Giới hạn giữ lại: không background daemon, không tự đọc code khi worker còn sống, không tự quyết semantics, không tự duyệt, và không biến worker claim thành proof độc lập.

`inbox.md` dùng chung được thay bằng một file mỗi assignment trong `inbox/`; agent name trong path ngăn worker cũ ghi đè report của owner mới sau handoff.
Worker vẫn không được đọc `backlog.md`, nên cơ chế loại transcript Foreman khi ghim trace còn nguyên.

### 2026-09-21 — Nhận quản lý worker đã chạy: **nhận**

Observer chỉ cần một assignment `[~]` có owner ổn định, nhưng flow cũ chỉ tạo assignment sau khi Foreman gửi task prompt.
Vì vậy một worker được Human khởi động và giao việc trực tiếp không thể được Foreman theo dõi giữa chừng.

Cho phép Human yêu cầu Foreman nhận quản lý agent đang `working` trong cùng repo.
Foreman ghi requirement bền vững, đăng ký worker làm owner, tạo snapshot ban đầu và bật observer mà không gửi lại task prompt.

Không đọc transcript để dựng requirement và không nhận quản lý agent đang giữ item khác.
Giới hạn target ở trạng thái `working`; trạng thái đã dừng đi qua supervision flow tương ứng thay vì bị ghi giả thành assignment đang chạy.

Ngoại lệ này không nới quyền tự adopt.
Human phải chỉ rõ worker và cung cấp requirement hoặc trỏ tới item `[ ]` đã có.
