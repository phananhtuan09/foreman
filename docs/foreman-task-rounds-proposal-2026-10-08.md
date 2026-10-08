# Proposal: Task nhiều vòng, cùng một worker

Ngày: 2026-10-08 · Dựa trên `phananhtuan09/foreman` tại `da91e00` · Thay thế bộ proposal ngày 2026-10-07 cho bài toán task chưa rõ.
Cập nhật cùng ngày: Foreman **viết lại** yêu cầu trước khi gửi worker, thay cho quy tắc gửi nguyên văn. Lời gốc vẫn được lưu.

## Ý chính

Bỏ hết việc phân loại trước, cả ở phía Foreman lẫn phía worker.

Một task là một chuỗi **vòng** với cùng một worker:

1. Bạn giao yêu cầu.
2. Worker làm rồi report.
3. Bạn đọc report và quyết định vòng tiếp theo: sửa, điều tra thêm, hay accept.

Foreman làm bốn việc:

- **Viết lại** lời bạn thành một chỉ dẫn rõ cho worker. Việc này chỉ dựa trên lời bạn và report đã có, không thêm kiến thức dự án.
- **Lưu cả hai bản**: bản viết lại (gửi đi) và lời gốc của bạn.
- **Đổi type và lease** nếu bạn nói rõ là chuyển giữa điều tra và sửa.
- **Gửi tiếp** cho đúng worker đó, rồi cho bạn thấy bản đã gửi.

Tạo task mới hoặc mở worker mới chỉ xảy ra khi bạn nói ra.

## Hiện tại đã có gì, còn thiếu gì

Khoảng 70% flow này đã chạy được bằng `task message`. Lệnh này gửi tới cùng worker và mở lại task đang `blocked` hoặc `review-ready` (`src/foreman.js:1450`). Còn thiếu năm chỗ:

| # | Thiếu | Hậu quả thực tế | Chỗ trong code |
|---|---|---|---|
| 1 | Lời bạn ở các vòng sau chỉ nằm trong outbox, không vào `brief.md` | Khi recover worker chết, worker mới chỉ nhận yêu cầu ban đầu và report cuối, mất hết các chỉ đạo vòng 2, 3… | `buildHandoffPackage` chỉ đọc `brief.md`, decisions và `lastReport` (`src/coordination.js:336`) |
| 2 | Type không đổi được | Điều tra xong muốn sửa thì phải `task promote`: task mới, router lại, chọn profile lại, worker mới | SPEC §7.10; `promoteScout` (`:1522`) |
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
         ── report vòng 1: webhook retry không idempotent. Hướng: (1) idempotency key (2) khoá nút ──
Bạn:     T-40 làm 1 đi, chưa đụng UI, bảo nó chạy test luôn
Foreman: T-000040 vòng 2 · sửa code · lease workspace/shop exclusive · gửi @shop-t-000040:
           "Thực hiện hướng 1 trong report vòng 1 của bạn: thêm idempotency key cho webhook payment
            để retry không cộng phí lần 2. Chưa thay đổi UI. Chạy test liên quan trước khi report."
         ── cùng worker, nguyên context → report blocked: cần thêm cột vào orders (~5M dòng) ──
Bạn:     xem thử dùng bảng riêng payment_events có ổn ko, đừng sửa gì thêm
Foreman: T-000040 vòng 3 · chuyển về điều tra (chỉ đọc) · gửi:
           "Đánh giá phương án lưu idempotency key trong bảng riêng payment_events thay vì thêm cột
            vào orders. Không sửa thêm code ở vòng này. Report: ưu nhược điểm và đề xuất."
Bạn:     accept T-40
```

Nếu bản viết lại sai ý, bạn sửa ngay:

```
Bạn:     T-40 dừng, ý mình là chỉ chạy test của payment thôi chứ không phải cả suite
Foreman: T-000040 đã ngắt lượt đang chạy · vòng 3 gửi lại:
           "Chỉ chạy test trong tests/payment/, không chạy cả suite. Các yêu cầu khác ở vòng 2 giữ nguyên."
```

Khi worker bắt đầu lan man:

```
Bạn:     T-40 mở worker mới, dùng claude-opus
Foreman: T-000040 → @shop-t-000040-r2 (claude-opus). Worker cũ đã dừng.
         Worker mới nhận: mọi chỉ dẫn đã gửi + report cuối mỗi vòng, được dặn kiểm tra workspace trước khi sửa.
```

## Quy tắc viết lại

Foreman không có context dự án. Vì vậy nó chỉ được viết lại từ đúng ba nguồn: câu bạn vừa nói, các vòng trước của task, và report của worker.

**Được làm**

- Bỏ phần nói với Foreman: mã task, "bảo nó", "giao cho codex", "gấp", tên worker.
- Giải tham chiếu bằng cách trích lại từ report. Ví dụ "làm 1" thành nội dung hướng 1 trong report, "cái lỗi đó" thành tên lỗi worker đã báo.
- Sắp lại thành câu mệnh lệnh rõ: làm gì, giới hạn gì, report gì.
- Gộp nhiều tin nhắn liên tiếp của bạn cho cùng một task thành một chỉ dẫn.
- Sửa lỗi gõ, viết rõ chữ viết tắt.

**Không được làm**

- Thêm quyết định kỹ thuật mà bạn hay report chưa nói: tên file, thư viện, cách sửa, tiêu chí nghiệm thu tự nghĩ ra.
- Bỏ một ràng buộc bạn đã nói, kể cả khi nó có vẻ thừa.
- Nới hoặc thu hẹp phạm vi.

**Phải hỏi lại thay vì viết**

- Tham chiếu không tìm thấy trên đĩa, ví dụ "làm như hôm trước" mà không có gì để trích.
- Câu mâu thuẫn với một vòng trước mà không nói rõ là đổi ý.

Hai trường hợp này đi bằng một câu hỏi duy nhất, chưa gửi gì cho worker.

**Luôn cho bạn thấy bản đã gửi.** Sau mỗi lần gửi, Foreman in nguyên bản viết lại, ngắn gọn. Mặc định là gửi ngay rồi hiện, không chờ duyệt, vì chờ duyệt thêm một lần chạm mỗi vòng. Nếu bạn muốn xem trước khi gửi, chỉ cần nói "xem trước".

## Ai quyết gì

| Việc | Người quyết | Ghi chú |
|---|---|---|
| Ý của mỗi vòng | Bạn | Lời gốc được lưu nguyên văn |
| Câu chữ gửi worker | Foreman | Theo quy tắc viết lại ở trên; bạn thấy bản gửi và sửa được ngay |
| Chuyển điều tra ↔ sửa | Bạn | Foreman chỉ đổi khi câu của bạn nói rõ ("sửa", "fix", "đừng sửa gì thêm"). Không rõ thì giữ chế độ hiện tại, và dòng xác nhận có ghi chế độ |
| Lease | Tự động theo chế độ | Điều tra → `workspace/<project>` read; sửa → `workspace/<project>` exclusive (mặc định hiện nay). Chỉ hẹp hơn khi bạn đưa `--resources` |
| Task mới | Bạn | Foreman không tự `task create` hay `task promote` khi bạn đang trả lời report của một task |
| Worker mới | Bạn | Qua `task reassign`. Foreman có thể *gợi ý* khi số vòng cao, nhưng không tự làm |
| Kết thúc | Bạn | `task accept` như cũ |

## Thay đổi cụ thể

### 1. Lệnh `task continue` (thay cho `task message` khi trả lời report)

```
task continue --task ID (--text TEXT | --text-file FILE) --original TEXT
              [--type scout|ship] [--resources JSON] [--interrupt]
```

- `--text` là bản Foreman viết lại.
- `--original` là lời bạn nguyên văn, bắt buộc. Nếu Foreman không viết lại gì thì hai giá trị bằng nhau.

Trong `src/foreman.js`, thêm `continueTask()`. Hàm này dùng lại phần gửi của `sendWorkerMessage` và chạy dưới home lock:

1. **Kiểm tra worker đang chờ bạn.** Task phải ở `review-ready` hoặc `blocked`, hoặc ở `working` nhưng đã report từ lần prompt gần nhất (`reportedSincePrompt`).
   - Nếu worker còn đang chạy: từ chối, trừ khi có `--interrupt`.
   - Với `--interrupt`: gọi `adapter.interrupt(endpoint)` trước. Cả Herdr (`src/herdr.js:71`) lẫn Paseo đã có primitive này và tự xác minh endpoint còn sống, đã ngừng chạy. Đây là đường sửa nhanh khi bản viết lại sai ý.
2. **Nối vòng mới vào `brief.md`:**
   ```
   ## Vòng 2 · 2026-10-08T10:12
   ### Gửi worker
   Thực hiện hướng 1 trong report vòng 1 của bạn: thêm idempotency key cho webhook payment …
   ### Lời gốc
   T-40 làm 1 đi, chưa đụng UI, bảo nó chạy test luôn
   ```
   `brief.md` là log chỉ-nối-thêm; không ai sửa vòng cũ. SPEC §5.6 ("persisted verbatim before being sent") vẫn đúng.
3. **Đổi type và lease nếu cần.** Khi có `--type` khác type hiện tại: cập nhật `meta.type`, rồi claim lại lease tại chỗ bằng `claimResourcesUnlocked({ ignoreLeaseId: lease cũ, generation hiện tại, owner hiện tại, allowConflicts: true })`.
   - Chồng lease chỉ cảnh báo, giống `task dispatch` tay (`warnResourceConflicts`).
   - Kiểm tra "scout chỉ được claim read" (`:813`) áp theo type mới.
4. **Gửi.** Message kind mới `task-update` tới cùng endpoint và generation, nội dung là **bản viết lại**. Phần Paseo cursor xử lý y như `sendWorkerMessage`.
5. **Cập nhật meta:** `status: working`, `completionReport: null`, `round`, `lastPromptAt`.

Trong `deliveryPrompt` (`src/coordination.js:101`), thêm cách render cho `task-update`:

```
Foreman task T-000040 | project shop | ship | round 2 | generation 1
Allowed resources: workspace/shop (exclusive)   ← changed from read

## User request (round 2)
Thực hiện hướng 1 trong report vòng 1 của bạn: thêm idempotency key cho webhook payment
để retry không cộng phí lần 2. Chưa thay đổi UI. Chạy test liên quan trước khi report.

## Report
…
```

Mặc định lời gốc **không** gửi cho worker; đó chính là nhiễu bạn muốn bỏ. Có thể bật `--with-original` để thêm một mục "User's original words (reference)" khi muốn worker tự soát xem Foreman có hiểu sai không. Đổi lại, worker lại thấy phần nói với Foreman.

### 2. Áp dụng cho lúc tạo task

`task create` nhận `--brief` (bản viết lại) và `--original` (nguyên văn). `brief.md` vòng 1 có cùng cấu trúc hai mục như trên.

Router đọc bản viết lại, vì nó đã bỏ phần nói với Foreman. Nếu bạn có nói tool hay profile ("dùng claude"), bản viết lại vẫn phải giữ ý đó để router thấy. Đây là lý do hiện nay skill bắt gửi nguyên văn (dòng 19).

### 3. Lệnh `task reassign` (đổi worker theo ý bạn)

```
task reassign --task ID [--profile NAME] [--owner NAME]
```

`recoverDeadWorker` bỏ điều kiện `dead`/`missing` và chỉ được gọi từ lệnh này:

- `buildHandoffPackage(reason: "human-reassign")`, rồi `assignTask({ handoff, dispatchProfile?, allowResourceConflicts: true })`.
- `assignTask` vốn đã dừng và kiểm endpoint cũ trước khi spawn (`:887–897`) và tăng generation. Report từ worker cũ sẽ bị từ chối (SPEC §5.7).
- Cần nới `assertTaskDispatchable` cho trường hợp reassign từ `review-ready`, giống cách nó đang nới `waiting-decision` khi có handoff.
- `--profile` đi qua `confirmTaskProfile`/`materializeDispatchProfile`. Không truyền thì giữ profile đã xác nhận, như recover hiện nay.

### 4. Handoff mang đủ các vòng

Trong `buildHandoffPackage`:

- `brief`: worker mới nhận phần "Gửi worker" của mọi vòng. Phần "Lời gốc" đi kèm dạng tham khảo, vì worker mới không có context để tự hiểu các câu tắt.
- Thêm `roundReports`: report kết thúc mỗi vòng (`done`/`blocked`), lấy từ `reports/`, giới hạn độ dài (ví dụ 4.000 ký tự mỗi report và 5 vòng gần nhất).

Lỗ hổng #1 trong bảng trên được vá luôn cho cả `task recover`, không chỉ reassign.

### 5. Hiển thị

Trong `renderUserReport` (`:1639`):

- Hiện số vòng.
- Dòng mô tả lấy câu đầu của bản viết lại ở **vòng mới nhất**: `T-000040 (vòng 2) Thực hiện hướng 1: thêm idempotency key cho webhook payment — @shop-t-000040: bị chặn.`
- Với Paseo, nếu `lastUsage` có số token (bridge đã trả field này ở `foreman-paseo-bridge.js:79`), hiện kèm để bạn tự quyết khi nào nên `reassign`.

### 6. Report của worker kết thúc bằng "bước tiếp theo"

Sửa một dòng trong `REPORT_COMMAND` và phần Paseo: "End `done`/`blocked` summaries with 1–3 numbered next steps the user could ask for."

Có danh sách đánh số thì "làm 1" luôn trích lại được chính xác. Foreman không phải diễn giải.

### 7. Skill và SPEC

`foreman-control/SKILL.md`:

- Dòng 19 ("pass the user's request verbatim as `--brief`") và dòng 27 ("Send a follow-up with … `task message` using the user's words") thay bằng mục **Quy tắc viết lại** ở trên, kèm 3–4 ví dụ đúng/sai.
- Trả lời report của task nào thì dùng `task continue` trên đúng task đó, luôn truyền `--original`.
- Chỉ truyền `--type` khi người dùng nói rõ chuyển giữa điều tra và sửa.
- Sau khi gửi, in một dòng (vòng, chế độ, lease, worker) và bản đã gửi.
- Không tạo task mới, không promote, không reassign trừ khi người dùng yêu cầu.
- `task message` chỉ còn dùng cho việc Foreman tự hỏi worker (ví dụ `idle-without-report`).

SPEC cần sửa:

- §5.6: giữ "persisted verbatim"; bỏ yêu cầu gửi nguyên văn; thêm "Foreman may rewrite the request for the worker from the user's words, prior rounds and worker reports only; both versions are persisted".
- §7.3: `brief.md` gồm các vòng, mỗi vòng có bản gửi và lời gốc.
- §7.7 dòng 287 và §9.2 dòng 422: worker nhận bản viết lại.
- §7.10: type chỉ đổi được bởi một vòng do người dùng chỉ đạo.
- §11.7: thêm reassign do người dùng yêu cầu.
- §11.9: promote trở thành tuỳ chọn.
- §18 câu 3: đổi thành "preserves user wording on disk".

## Vì sao viết lại được mà vẫn không cần context dự án

Viết lại ở đây là **biên tập lời bạn**, không phải **thiết kế lời giải**. Mọi thông tin trong bản viết lại phải trích được từ lời bạn hoặc từ report. Foreman không phải hiểu dự án mới làm được việc đó, cũng như thư ký không cần biết code vẫn chuyển lời rõ ràng được.

Còn phần kỹ thuật thì worker đang giữ task vẫn có đủ context.

Lịch sử repo:

- Legacy đã từng nới một bước: quyết định 2026-08-14 "Lọc vỏ điều phối khỏi prompt worker" cho bỏ mệnh đề điều phối, nhưng cấm đổi chữ.
- Proposal này đi tiếp một bước: cho đổi chữ và giải tham chiếu, đổi lại bằng việc lưu lời gốc và luôn cho bạn thấy bản đã gửi.

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

- 2 lệnh mới (`continue`, `reassign`), 1 cờ mới cho `create` (`--original`);
- 1 message kind mới;
- 2 field meta: `round`, và `type` được phép đổi;
- sửa handoff, render, một dòng trong report template, và skill.

Không thêm lifecycle state nào. Ước lượng theo cảm nhận: khoảng 250–350 dòng code cộng test, phần lớn là dùng lại `sendWorkerMessage`, `claimResourcesUnlocked`, `recoverDeadWorker` và `adapter.interrupt`.

## Tuỳ chọn nên làm kèm

**Thông báo khi worker report (P6 rút gọn).** Flow nhiều vòng nghĩa là nhiều lần chờ; hiện bạn phải tự hỏi "T-40 sao rồi?" mỗi vòng.

- Trong `recordReport` (chạy trong process của worker), sau khi ghi report, gọi `FOREMAN_NOTIFY_COMMAND` nếu được cấu hình.
- Lệnh chạy không qua shell, timeout 2s, nuốt mọi lỗi. Không daemon, không token.
- Chưa kiểm chứng `herdr notification` có dùng được cho việc này không.

## Rủi ro và điểm chưa kiểm chứng

- **Foreman hiểu sai ý khi viết lại.** Đây là rủi ro chính của bản cập nhật. Giảm thiểu:
  - giới hạn nguồn (chỉ lời bạn, các vòng trước, report);
  - hỏi lại khi tham chiếu không có trên đĩa;
  - luôn hiện bản đã gửi;
  - `--interrupt` để sửa ngay;
  - lời gốc lưu cạnh bản gửi để soát lại sau.

  Không có cách máy kiểm "Foreman có thêm ý không". Phần đó dựa vào kỷ luật của skill và việc bạn liếc bản đã gửi.
- **Viết lại quá dài hoặc tự thêm tiêu chí.** Skill nên có ví dụ sai rõ ràng. Nên theo dõi vài tuần đầu.
- **Context phình theo số vòng.** Hiện số vòng (và token với Paseo), `reassign` khi bạn thấy cần. Chưa đo ngưỡng thực tế.
- **Đoán sai chế độ từ câu của bạn.** Chỉ đổi khi câu nói rõ, luôn in chế độ trong dòng xác nhận. Sai cũng rẻ vì lease chỉ để phối hợp, không phải sandbox (SPEC §20.3).
- **`--interrupt` trên Herdr.** Primitive có sẵn và tự xác minh, nhưng chưa có CLI nào dùng nó, nên chưa được chạy thật qua flow này.
- **`lastUsage` của Paseo.** Chưa kiểm chứng payload có số token dùng được.
- **Test hiện có** chỉ một chỗ đụng tới type (`test/core-runtime.test.js:174`), và quy tắc đó vẫn đúng theo type hiện hành.
