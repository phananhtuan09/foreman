# Proposal: Task nhiều vòng, cùng một worker

Ngày: 2026-10-08 · Dựa trên `phananhtuan09/foreman` tại `da91e00` · Thay thế bộ proposal ngày 2026-10-07 cho bài toán task chưa rõ.
Cập nhật cùng ngày: Foreman **viết lại** yêu cầu trước khi gửi worker, thay cho quy tắc gửi nguyên văn. Lời gốc vẫn được lưu.
Cập nhật lần 2 (sau review): chốt flow `blocked`, hành vi `reassign`, lease khi đổi chế độ; đổi cách lưu vòng sang file JSON riêng; ghi rõ các chi tiết implement. Xem mục "Quyết định đã chốt".

## Ý chính

Bỏ hết việc phân loại trước, cả ở phía Foreman lẫn phía worker.

Một task là một chuỗi **vòng** với cùng một worker:

1. Bạn giao yêu cầu.
2. Worker làm rồi report.
3. Bạn đọc report và quyết định vòng tiếp theo: sửa, điều tra thêm, hay accept.

Foreman làm bốn việc:

- **Viết lại** lời bạn thành một chỉ dẫn rõ cho worker. Việc này chỉ dựa trên lời bạn và report đã có, không thêm kiến thức dự án.
- **Lưu cả hai bản**: bản viết lại (gửi đi) và lời gốc của bạn.
- **Đổi chế độ và lease** nếu bạn nói rõ là chuyển giữa điều tra và sửa.
- **Gửi tiếp** cho đúng worker đó, rồi cho bạn thấy bản đã gửi.

Tạo task mới hoặc mở worker mới chỉ xảy ra khi bạn nói ra.

## Quyết định đã chốt

| Câu hỏi | Chốt |
|---|---|
| Worker report `blocked`, bạn trả lời thế nào? | Luôn là **một vòng mới** qua `task continue`. Decision Package chỉ còn dùng khi Foreman tự thấy cần bạn quyết một việc về sản phẩm, kiến trúc, tương thích, bảo mật hay vận hành. |
| `reassign` không kèm yêu cầu thì worker mới làm gì? | **Chỉ kiểm tra rồi report**: đọc mọi chỉ dẫn, kiểm tra workspace, report tình trạng hiện tại, không làm thêm. Có kèm yêu cầu thì yêu cầu đó được gửi luôn như vòng tiếp theo. |
| Task đã sửa code rồi chuyển về điều tra, lease thế nào? | **Giữ exclusive** tới khi accept, vì workspace còn thay đổi dở. Chỉ chỉ dẫn gửi worker đổi sang chỉ đọc. |

## Hiện tại đã có gì, còn thiếu gì

Khoảng 70% flow này đã chạy được bằng `task message`. Lệnh này gửi tới cùng worker và mở lại task đang `blocked` hoặc `review-ready` (`src/foreman.js:1450`). Còn thiếu năm chỗ:

| # | Thiếu | Hậu quả thực tế | Chỗ trong code |
|---|---|---|---|
| 1 | Lời bạn ở các vòng sau chỉ nằm trong outbox, không lưu cùng task | Khi recover worker chết, worker mới chỉ nhận yêu cầu ban đầu và report cuối, mất hết các chỉ đạo vòng 2, 3… | `buildHandoffPackage` chỉ đọc `brief.md`, decisions và `lastReport` (`src/coordination.js:336`) |
| 2 | Không đổi được giữa điều tra và sửa | Điều tra xong muốn sửa thì phải `task promote`: task mới, router lại, chọn profile lại, worker mới | SPEC §7.10; `promoteScout` (`:1522`) |
| 3 | Lease không đổi được khi task đang chạy | Task điều tra giữ lease `read`; chuyển sang sửa thì lease vẫn là `read` | `claimResourcesUnlocked` chỉ được gọi lúc dispatch/adopt/recover |
| 4 | Không có cách đổi worker theo ý bạn | `task recover` chỉ chạy khi worker `dead`/`missing`; muốn đổi model hoặc làm mới context thì không có lệnh | `recoverDeadWorker` (`:1551`), `assertTaskDispatchable` chặn `review-ready` (`:755`) |
| 5 | Quy tắc nguyên văn | Câu nói với Foreman ("T-40…", "bảo nó…", "làm 1") đi thẳng sang worker; worker phải tự đoán phần nào là việc của nó | Skill `foreman-control` dòng 19 và 27; SPEC §7.7, §9.2 |

## Flow mẫu

```
Bạn:     điều tra bug: đơn hàng thỉnh thoảng bị tính phí ship 2 lần (shop)
Foreman: Tạo T-000040 · điều tra (chỉ đọc). Gửi worker:
           "Điều tra vì sao đơn hàng đôi khi bị tính phí ship 2 lần. Chưa sửa code.
            Report: nguyên nhân, bằng chứng, các hướng sửa."
         Chọn profile: 1 codex-luna (đề xuất) · 2 … · 3 … · 4 …
Bạn:     1
         ── report vòng 1: webhook retry không idempotent. Bước tiếp theo: 1. idempotency key  2. khoá nút ──
Bạn:     T-40 làm 1 đi, chưa đụng UI, bảo nó chạy test luôn
Foreman: T-000040 vòng 2 · sửa code · lease workspace/shop exclusive · gửi @shop-t-000040:
           "Thực hiện bước 1 trong report vòng 1 của bạn: thêm idempotency key cho webhook payment
            để retry không cộng phí lần 2. Chưa thay đổi UI. Chạy test liên quan trước khi report."
         ── cùng worker, nguyên context → report blocked: cần thêm cột vào orders (~5M dòng) ──
Bạn:     xem thử dùng bảng riêng payment_events có ổn ko, đừng sửa gì thêm
Foreman: T-000040 vòng 3 · điều tra (chỉ đọc) · lease giữ exclusive vì workspace còn thay đổi dở · gửi:
           "Đánh giá phương án lưu idempotency key trong bảng riêng payment_events thay vì thêm cột
            vào orders. Không sửa thêm code ở vòng này. Report: ưu nhược điểm và đề xuất."
Bạn:     accept T-40
```

Nếu bản viết lại sai ý, bạn sửa ngay. Ví dụ ngay sau khi vòng 2 vừa gửi:

```
Bạn:     T-40 dừng, ý mình là chỉ chạy test của payment thôi chứ không phải cả suite
Foreman: T-000040 đã ngắt lượt đang chạy · vòng 3 (thay thế vòng 2) gửi:
           "Chỉ dẫn này thay thế vòng 2, vòng đó đã bị ngắt giữa chừng; kiểm tra phần đã sửa dở trước khi làm tiếp.
            Thực hiện bước 1 trong report vòng 1: thêm idempotency key cho webhook payment để retry không cộng
            phí lần 2. Chưa thay đổi UI. Chỉ chạy test trong tests/payment/, không chạy cả suite."
```

Bản sửa luôn là một vòng mới có `supersedes`, vì lịch sử vòng chỉ nối thêm. Nó nhắc lại đủ chỉ dẫn của vòng bị thay để worker không phải ghép hai vòng.

Khi worker bắt đầu lan man:

```
Bạn:     T-40 mở worker mới, dùng claude-opus
Foreman: T-000040 → @shop-t-000040-r2 (claude-opus). Worker cũ đã dừng.
         Worker mới nhận mọi chỉ dẫn đã gửi + report cuối mỗi vòng; nó kiểm tra workspace rồi report tình trạng, chưa làm thêm.
```

## Quy tắc viết lại

Foreman không có context dự án. Vì vậy nó chỉ được viết lại từ đúng ba nguồn: câu bạn vừa nói, các vòng trước của task, và report của worker.

**Được làm**

- Bỏ phần nói với Foreman: mã task, "bảo nó", "giao cho codex", "dùng claude", "gấp", tên worker.
- Giải tham chiếu bằng cách trích lại từ report. Ví dụ "làm 1" thành nội dung bước 1 trong report, "cái lỗi đó" thành tên lỗi worker đã báo.
- Sắp lại thành câu mệnh lệnh rõ: làm gì, giới hạn gì, report gì.
- Gộp nhiều tin nhắn của bạn cho cùng một task **trong cùng một lượt Foreman** thành một chỉ dẫn. Tin đến sau khi đã gửi thì là vòng mới, hoặc bản sửa có `--interrupt` nếu bạn bảo dừng.
- Sửa lỗi gõ, viết rõ chữ viết tắt.

**Không được làm**

- Thêm quyết định kỹ thuật mà bạn hay report chưa nói: tên file, thư viện, cách sửa, tiêu chí nghiệm thu tự nghĩ ra.
- Bỏ một ràng buộc bạn đã nói, kể cả khi nó có vẻ thừa.
- Nới hoặc thu hẹp phạm vi.
- Đổi chữ trong phần bạn đặt trong **ngoặc kép**. Phần đó được gửi nguyên văn; đây là lối thoát khi bạn muốn worker nhận đúng câu của mình.

**Phải hỏi lại thay vì viết**

- Tham chiếu không tìm thấy trên đĩa, ví dụ "làm như hôm trước" mà không có gì để trích.
- Câu mâu thuẫn với một vòng trước mà không nói rõ là đổi ý.

Hai trường hợp này đi bằng một câu hỏi duy nhất, chưa gửi gì cho worker.

**Luôn cho bạn thấy bản đã gửi.** Sau mỗi lần gửi, Foreman in nguyên bản viết lại, ngắn gọn. Mặc định là gửi ngay rồi hiện, không chờ duyệt, vì chờ duyệt thêm một lần chạm mỗi vòng. Nếu bạn nói "xem trước" thì riêng tin đó Foreman hiện bản viết lại và chờ bạn đồng ý; không lưu thành tuỳ chọn.

**Không viết lại** câu trả lời cho Decision Package (`decision answer`): câu đó vẫn được lưu và gửi nguyên văn như hiện nay.

## Ai quyết gì

| Việc | Người quyết | Ghi chú |
|---|---|---|
| Ý của mỗi vòng | Bạn | Lời gốc được lưu nguyên văn |
| Câu chữ gửi worker | Foreman | Theo quy tắc viết lại ở trên; bạn thấy bản gửi và sửa được ngay |
| Chuyển điều tra ↔ sửa | Bạn | Foreman chỉ đổi khi câu của bạn nói rõ ("sửa", "fix", "đừng sửa gì thêm"). Không rõ thì giữ chế độ hiện tại, và dòng xác nhận có ghi chế độ |
| Lease | Tự động theo chế độ | Điều tra → `workspace/<project>` read; sửa → `workspace/<project>` exclusive (mặc định hiện nay). Đã từng sửa thì giữ exclusive tới khi accept. Chỉ hẹp hơn khi bạn đưa `--resources` |
| Trả lời report `blocked` | Bạn | Luôn bằng một vòng mới qua `task continue` |
| Task mới | Bạn | Foreman không tự `task create` hay `task promote` khi bạn đang trả lời report của một task |
| Worker mới | Bạn | Qua `task reassign`. Foreman có thể *gợi ý* khi số vòng cao, nhưng không tự làm |
| Kết thúc | Bạn | `task accept` như cũ |

## Thay đổi cụ thể

### 1. Lưu vòng

Mỗi vòng là một file JSON riêng, không nối vào `brief.md`:

```
data/tasks/T-000040/
├── brief.md                 bản gửi worker của vòng 1 (giữ nguyên vai trò hiện nay)
├── original.md              lời gốc của vòng 1
└── rounds/
    ├── round-002.json
    └── round-003.json
```

```json
{
  "schemaVersion": 1,
  "taskId": "T-000040",
  "round": 2,
  "generation": 1,
  "createdAt": "2026-10-08T10:12:00Z",
  "sent": "Thực hiện bước 1 trong report vòng 1 của bạn: …",
  "original": "T-40 làm 1 đi, chưa đụng UI, bảo nó chạy test luôn",
  "mode": "ship",
  "resources": [{ "key": "workspace/shop", "mode": "exclusive" }],
  "supersedes": null,
  "messageId": "M-…",
  "status": "pending | delivered | failed"
}
```

Lý do không nối vào `brief.md`: sáu chỗ đang đọc file này nguyên văn (dispatch, router, tiêu đề hiển thị, promote, adopt, reconstruct). Nếu nối markdown thì lời gốc sẽ lọt vào prompt dispatch/recover, còn tiêu đề sẽ thành dòng `## Vòng 1`. Tách vòng bằng parse markdown cũng dễ vỡ khi lời bạn chứa chính tiêu đề đó.

- Vòng 1 = `brief.md` + `original.md`. Task cũ không có `original.md` hay `rounds/` được coi như đang ở vòng 1 với lời gốc bằng `brief.md`.
- File vòng chỉ có một writer (`task continue`/`reassign` dưới home lock) và bị xoá cùng thư mục task khi accept hoặc discard (SPEC §5.10).
- `meta.round` là vòng hiện tại. Vòng có `status: failed` không tăng `meta.round`.
- Report ghi thêm header `ROUND: N`, và `lastReport` có field `round`, để handoff và hiển thị ghép được report với vòng.

### 2. Lệnh `task continue` (thay cho `task message` khi trả lời report)

```
task continue --task ID (--text TEXT | --text-file FILE) --original TEXT
              [--type scout|ship] [--resources JSON] [--interrupt] [--with-original]
```

- `--text` là bản Foreman viết lại.
- `--original` là lời bạn nguyên văn, bắt buộc. Nếu Foreman không viết lại gì thì hai giá trị bằng nhau.
- `--with-original` thêm mục "User's original words (reference)" vào prompt. Mặc định tắt.

Trong `src/foreman.js`, thêm `continueTask()`. Hàm này dùng lại phần gửi của `sendWorkerMessage` và chạy dưới home lock:

1. **Kiểm tra worker đang chờ bạn.**
   - Với Paseo, chạy `task collect` cho task đó trước để report mới nhất đã được ghi.
   - Task phải ở `review-ready` hoặc `blocked`, hoặc ở `working` nhưng đã report từ lần prompt gần nhất (`reportedSincePrompt`).
   - Task `waiting-decision` bị từ chối: decision đó phải được trả lời bằng `decision answer`.
   - Nếu `inspect` cho thấy worker còn đang chạy: từ chối, trừ khi có `--interrupt`. Nếu trạng thái là `unknown`: từ chối, kể cả khi có `--interrupt`.
   - Với `--interrupt`: chỉ gọi `adapter.interrupt(endpoint)` khi `inspect` báo đang chạy. Herdr gửi `ctrl-c`, nên gửi lúc agent đang idle có thể làm nó thoát. Vòng mới có `supersedes` trỏ tới vòng bị ngắt, và prompt nói rõ chỉ dẫn này thay thế vòng đó.
2. **Ghi vòng mới** `rounds/round-NNN.json` với `status: pending`.
3. **Đổi chế độ và lease nếu cần.** Khi `--type` khác chế độ hiện tại:
   - cập nhật `meta.type` (= chế độ của vòng hiện tại) và ghi `meta.everShip = true` nếu chuyển sang ship;
   - claim lại lease tại chỗ bằng `claimResourcesUnlocked({ ignoreLeaseId: lease cũ, generation hiện tại, owner hiện tại, allowConflicts: true })`. Chồng lease chỉ cảnh báo, giống `task dispatch` tay (`warnResourceConflicts`);
   - chuyển ship → scout khi `everShip` thì **giữ nguyên lease exclusive**, chỉ đổi chế độ trong prompt;
   - kiểm tra "scout chỉ được claim read" (`:813`) chỉ áp khi task chưa từng là ship.
4. **Gửi.** Message kind mới `task-update` tới cùng endpoint và generation, nội dung là **bản viết lại**. Phần Paseo cursor xử lý y như `sendWorkerMessage`.
5. **Gửi lỗi thì trả lại như cũ.** Vòng chuyển `status: failed`, lease và `meta.type` được trả về giá trị trước đó, `meta` không đổi trạng thái. Chạy lại lệnh sẽ tạo vòng mới cùng số.
6. **Gửi được thì cập nhật meta:** `status: working`, `completionReport: null`, `round`, `lastPromptAt`.

Trong `deliveryPrompt` (`src/coordination.js:101`), thêm cách render cho `task-update`:

```
Foreman task T-000040 | project shop | ship | round 2 | generation 1
Allowed resources: workspace/shop (exclusive)   ← changed from read

## User request (round 2)
Thực hiện bước 1 trong report vòng 1 của bạn: thêm idempotency key cho webhook payment
để retry không cộng phí lần 2. Chưa thay đổi UI. Chạy test liên quan trước khi report.

## Report
…
```

Khi chế độ là scout nhưng lease vẫn exclusive, header ghi `scout (read-only for this round)`.

### 3. Áp dụng cho lúc tạo task

`task create` nhận `--brief` (bản viết lại) và `--original` (nguyên văn, tuỳ chọn để giữ tương thích; skill luôn truyền). `--original` được lưu vào `original.md`.

**Router đọc lời gốc** (`original.md`, nếu không có thì `brief.md`), vì lời gốc mới chứa ý về tool hay profile ("dùng claude"). Bản viết lại vì thế bỏ được mọi chữ về routing. `briefDigest` trong record routing tính trên đúng văn bản router đã đọc.

`task adopt` và `task promote` giữ nguyên cú pháp, nhận thêm `--original` tuỳ chọn.

### 4. Lệnh `task reassign` (đổi worker theo ý bạn)

```
task reassign --task ID [--profile NAME] [--owner NAME]
              [--text TEXT|--text-file FILE --original TEXT] [--type scout|ship]
```

Tách phần thay worker trong `recoverDeadWorker` thành helper dùng chung `replaceWorker({ reason })`:

- `task recover` giữ nguyên điều kiện `dead`/`missing` và bộ đếm `recoveryAttempts`.
- `task reassign` không cần `dead`/`missing` và **không** tính vào `recoveryAttempts`.
- Cả hai dùng `buildHandoffPackage(reason)` mới (mục 5) rồi `assignTask({ handoff, dispatchProfile?, allowResourceConflicts: true })`. `assignTask` vốn đã dừng và kiểm endpoint cũ trước khi spawn (`:887–897`) và tăng generation; report từ worker cũ sẽ bị từ chối (SPEC §5.7).

Điều kiện:

- Task phải ở `working`, `blocked` hoặc `review-ready`. Nới `assertTaskDispatchable` cho `review-ready` khi có handoff. Task `waiting-decision` bị từ chối, vì decision gắn với generation hiện tại sẽ không trả lời được sau khi generation tăng (`:1483`).
- Trạng thái runtime `unknown` thì từ chối; worker đang chạy thì `assignTask` dừng nó như khi recover.

`--profile`: không đi qua `confirmTaskProfile` (hàm này chỉ nhận task chưa giao, `:675`). Thay vào đó kiểm tra profile tồn tại và active trong config của backend, rồi `materializeDispatchProfile` và cập nhật `routingProfile`, `profileConfirmedAt`. Không truyền thì giữ profile hiện tại.

Worker mới làm gì:

- Không có `--text`: prompt handoff dặn worker đọc mọi chỉ dẫn, kiểm tra workspace, rồi report tình trạng hiện tại và **không làm thêm**. Task trở lại `working` cho tới report đó.
- Có `--text`: ghi một vòng mới như `task continue`, và bản viết lại được đưa vào prompt handoff là việc cần làm tiếp.

### 5. Handoff mang đủ các vòng

Trong `buildHandoffPackage`:

- `rounds`: với mỗi vòng đã `delivered`, lấy `sent` và `original` (lời gốc làm tham khảo, vì worker mới không có context để tự hiểu các câu tắt).
- `roundReports`: report kết thúc mỗi vòng (`done`/`blocked`), ghép theo header `ROUND`. Giới hạn 4.000 ký tự mỗi report và 5 vòng gần nhất. Report bị cắt có kèm đường dẫn file đầy đủ.
- Bỏ field `brief` khỏi handoff, vì `assignTask` đã đưa `brief.md` vào mục "User request"; hiện nay nội dung này bị in hai lần.

Lỗ hổng #1 trong bảng trên được vá cho cả `task recover` lẫn `task reassign`.

### 6. Hiển thị

Trong `renderUserReport` (`:1639`):

- Hiện số vòng.
- Dòng mô tả lấy câu đầu của bản viết lại ở **vòng mới nhất**: `T-000040 (vòng 2) Thực hiện bước 1: thêm idempotency key cho webhook payment — @shop-t-000040: bị chặn.`
- Với Paseo, nếu `lastUsage` có số token (bridge đã trả field này ở `foreman-paseo-bridge.js:79`), hiện kèm để bạn tự quyết khi nào nên `reassign`.

### 7. Report của worker kết thúc bằng một danh sách đánh số duy nhất

Sửa `REPORT_COMMAND` và chuỗi hướng dẫn report của Paseo (`src/coordination.js:110`):

- `done`/`blocked`: kết thúc bằng mục "Next steps" gồm 1–3 việc đánh số mà người dùng có thể yêu cầu tiếp.
- `blocked` bỏ cách nói "options, your recommendation" riêng; các lựa chọn chính là "Next steps", việc được đề xuất đánh dấu `(recommended)`.

Mỗi report chỉ có một danh sách đánh số, nên "làm 1" luôn trích lại đúng một mục. Foreman không phải diễn giải.

### 8. Skill và SPEC

`foreman-control/SKILL.md`:

- Dòng 19 ("pass the user's request verbatim as `--brief`") và dòng 27 ("Send a follow-up with … `task message` using the user's words") thay bằng mục **Quy tắc viết lại** ở trên, kèm 3–4 ví dụ đúng/sai.
- Trả lời report của task nào (kể cả `blocked`) thì dùng `task continue` trên đúng task đó, luôn truyền `--original`.
- Chỉ truyền `--type` khi người dùng nói rõ chuyển giữa điều tra và sửa.
- Sau khi gửi, in một dòng (vòng, chế độ, lease, worker) và bản đã gửi.
- Không tạo task mới, không promote, không reassign trừ khi người dùng yêu cầu.
- `task message` chỉ còn dùng cho việc Foreman tự hỏi worker (ví dụ `idle-without-report`).

`foreman-supervisor/SKILL.md` dòng 16: report `blocked` được hiện cho người dùng và trả lời bằng `task continue`. Foreman chỉ tạo Decision Package khi chính nó thấy việc cần người dùng quyết.

SPEC cần sửa:

- §5.6: giữ "persisted verbatim"; bỏ yêu cầu gửi nguyên văn; thêm "Foreman may rewrite the request for the worker from the user's words, prior rounds and worker reports only; both versions are persisted; quoted text and decision answers are sent verbatim".
- §7.3: thêm `original.md` và `rounds/`.
- §7.5: report có header `ROUND`.
- §7.7 và §9.2: worker nhận bản viết lại; thêm message kind `task-update`.
- §7.10: type là chế độ của vòng hiện tại, chỉ đổi bởi một vòng do người dùng chỉ đạo; task đã từng là ship giữ lease ghi.
- §9.1: thêm `continue` và `reassign` vào các thao tác do người yêu cầu được phép chồng lease.
- §10 bước 4 và §11.5: `blocked` được trả lời bằng một vòng mới.
- §11.7: thêm reassign do người dùng yêu cầu.
- §11.9: promote trở thành tuỳ chọn.
- §18 câu 3: đổi thành "preserves user wording on disk".
- §20.3: lease còn được claim lại khi đổi chế độ.

## Vì sao viết lại được mà vẫn không cần context dự án

Viết lại ở đây là **biên tập lời bạn**, không phải **thiết kế lời giải**. Mọi thông tin trong bản viết lại phải trích được từ lời bạn hoặc từ report. Foreman không phải hiểu dự án mới làm được việc đó, cũng như thư ký không cần biết code vẫn chuyển lời rõ ràng được.

Còn phần kỹ thuật thì worker đang giữ task vẫn có đủ context.

Lịch sử repo (`legacy/foreman-agent/DNA.md`):

- 2026-08-14 "Lọc vỏ điều phối khỏi prompt worker": cho bỏ mệnh đề điều phối nhưng cấm đổi chữ; đồng thời từ chối việc bắt Foreman hiểu task.
- 2026-08-17 "Nguồn của prompt là đĩa, và ngoặc kép là dạng tường minh": kết luận siết hay nới bộ lọc chỉ đổi bug này lấy bug ngược lại, nên chuyển chỗ sai sang nơi thấy ngay và sửa được.
- Proposal này đi tiếp một bước: cho đổi chữ và giải tham chiếu. Nó vẫn giữ tinh thần của 08-17: chỗ sai nằm ở nơi bạn thấy ngay (bản đã gửi luôn được in), sửa được ngay (`--interrupt`), và ngoặc kép vẫn là dạng gửi nguyên văn. Giải tham chiếu chỉ là trích lại một mục đánh số trong report, không phải hiểu task.

## So với bộ proposal hôm qua

| Hôm qua | Bây giờ |
|---|---|
| P1 gate `plan`/`auto`, status `plan-review`, `task go` | Bỏ. Vòng 1 "điều tra" + vòng 2 "sửa" làm cùng việc mà không cần state mới hay worker tự đánh giá |
| P3 router phân loại độ rõ | Bỏ. Không ai phân loại |
| P2 Question Packet, relay câu hỏi Paseo | Để sau. Worker hỏi thì report `blocked`, bạn trả lời bằng một vòng mới |
| P4 khám phá trực tiếp | Bỏ khỏi core |
| P5 promote giữ câu gốc | Bỏ, vì không còn cần promote |
| P6 thông báo | Tuỳ chọn, vẫn đáng làm (xem dưới) |
| P0 đo đếm | Tuỳ chọn |

Tổng thay đổi:

- 2 lệnh mới (`continue`, `reassign`), 1 cờ mới cho `create`, `adopt`, `promote` (`--original`);
- 1 message kind mới;
- record mới `rounds/round-NNN.json` và file `original.md`;
- field meta: `round`, `everShip`, và `type` được phép đổi;
- sửa handoff, render, report template, router input, và skill.

Không thêm lifecycle state nào. Ước lượng: khoảng 500–700 dòng code cộng test, phần lớn là dùng lại `sendWorkerMessage`, `claimResourcesUnlocked`, `recoverDeadWorker` và `adapter.interrupt`.

## Thứ tự implement

1. Lưu vòng (`original.md`, `rounds/`, header `ROUND`) và handoff mang đủ các vòng. Bước này có giá trị ngay cả khi chưa đổi gì khác, vì vá lỗ hổng #1.
2. `task continue`, chưa đổi chế độ.
3. `task reassign`.
4. Đổi chế độ và lease.
5. Router đọc lời gốc, report template, hiển thị.
6. Skill và SPEC theo quy tắc viết lại.

## Tuỳ chọn nên làm kèm

**Thông báo khi worker report (P6 rút gọn), chỉ cho Herdr.** Flow nhiều vòng nghĩa là nhiều lần chờ; hiện bạn phải tự hỏi "T-40 sao rồi?" mỗi vòng.

- Trong `recordReport` (chạy trong process của worker), sau khi ghi report, gọi `FOREMAN_NOTIFY_COMMAND` nếu được cấu hình. Biến này phải có trong môi trường của worker.
- Lệnh chạy không qua shell, timeout 2s, nuốt mọi lỗi. Không daemon, không token.
- Paseo không áp dụng được: report Paseo chỉ được ghi khi `task collect` chạy trong lượt Foreman.
- Chưa kiểm chứng `herdr notification` có dùng được cho việc này không.

## Rủi ro và điểm chưa kiểm chứng

- **Foreman hiểu sai ý khi viết lại.** Đây là rủi ro chính của bản cập nhật. Giảm thiểu:
  - giới hạn nguồn (chỉ lời bạn, các vòng trước, report);
  - hỏi lại khi tham chiếu không có trên đĩa;
  - luôn hiện bản đã gửi;
  - ngoặc kép để gửi nguyên văn;
  - `--interrupt` để sửa ngay;
  - lời gốc lưu cạnh bản gửi để soát lại sau.

  Không có cách máy kiểm "Foreman có thêm ý không". Phần đó dựa vào kỷ luật của skill và việc bạn liếc bản đã gửi.
- **Viết lại quá dài hoặc tự thêm tiêu chí.** Skill nên có ví dụ sai rõ ràng. Nên theo dõi vài tuần đầu.
- **Context phình theo số vòng.** Hiện số vòng (và token với Paseo), `reassign` khi bạn thấy cần. Chưa đo ngưỡng thực tế.
- **Đoán sai chế độ từ câu của bạn.** Chỉ đổi khi câu nói rõ, luôn in chế độ trong dòng xác nhận. Sai cũng rẻ vì lease chỉ để phối hợp, không phải sandbox (SPEC §20.3).
- **`--interrupt` trên Herdr.** Primitive có sẵn và tự xác minh, nhưng chưa có CLI nào dùng nó, nên chưa được chạy thật qua flow này. Transport gửi `ctrl-c`, nên chỉ được gọi khi worker đang chạy.
- **`--interrupt` trên Paseo.** Chưa kiểm chứng lượt bị ngắt có để lại một assistant message mà `task collect` hiểu nhầm là report hay không.
- **`lastUsage` của Paseo.** Chưa kiểm chứng payload có số token dùng được.
- **Test hiện có** chỉ một chỗ đụng tới type (`test/core-runtime.test.js:174`), và quy tắc đó vẫn đúng với task chưa từng là ship.
