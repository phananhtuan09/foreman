# Proposal: Gửi ảnh dán trong phiên Foreman tới worker

Ngày: 2026-10-09 · Dựa trên `phananhtuan09/foreman` tại `b1d8fbb` · Đối ứng issue #2.
Trạng thái: plan, chưa implement. Các mục "Cần chốt" ở cuối cần bạn quyết trước khi bắt đầu.

## Ý chính

Ảnh bạn dán vào phiên Foreman hiện chỉ nằm trong context của phiên đó.
Brief, round, message và decision đều chỉ là text, nên worker không bao giờ thấy ảnh.

Hướng giải:

1. **Bắt ảnh**: lấy byte của ảnh vừa dán từ client (Claude Code hoặc Codex) và đưa vào Foreman CLI qua cờ `--image`.
2. **Lưu ảnh**: lưu vào `data/tasks/<id>/attachments/` trước khi gửi, gắn với round, message hoặc decision mang nó.
3. **Giao ảnh**: chép ảnh vào một thư mục bị Git bỏ qua trong workspace của worker, rồi ghi đường dẫn trong prompt. Với Paseo, ảnh của tin nhắn hiện tại còn được gửi kèm trực tiếp qua `agent.send(..., { images })`.
4. **Bàn giao**: worker thay thế đọc được ảnh của mọi round trước, vì ảnh vẫn nằm trong workspace và handoff liệt kê chúng theo round.

Tin nhắn không có ảnh giữ nguyên prompt như hiện tại, từng byte.

## Hiện tại có gì, thiếu gì

| Chỗ | Hiện tại | Thiếu |
| --- | --- | --- |
| `createTaskUnlocked` (`src/foreman.js:732`) | ghi `brief.md`, `original.md`, `notes.md` | chỗ lưu ảnh của round một |
| `assignTask` (`src/foreman.js:797`) | dựng payload `task-brief` (`:932`), gọi `adapter.send` (`:939`) | đưa ảnh vào payload, chép ảnh vào workspace trước khi gửi |
| `deliverWorkerMessageUnlocked` (`src/foreman.js:1465`) | đường gửi chung cho `task message` và `task continue` | như trên |
| `deliverDecision` (`src/foreman.js:1659`) | tự gọi `adapter.send` | như trên |
| Adopt Paseo (`src/foreman.js:1443`) | tự dựng payload `task-brief` | như trên |
| `deliveryPrompt` (`src/coordination.js:130`) | template text cố định | mục `Images` |
| `buildHandoffPackage` (`src/coordination.js:408`) | mang các round đã gửi | ảnh của từng round |
| `HerdrCliTransport.send` (`src/herdr.js:319`) | `herdr agent prompt <endpoint> <text>` | không đổi: Herdr chỉ nhận text |
| `PaseoAdapter.send` (`src/paseo.js:55`) | chỉ chuyển `prompt` và `messageId` | chuyển danh sách ảnh |
| Bridge `send` (`bin/foreman-paseo-bridge.js:303`) | `agent.send(prompt, { messageId })` | đọc file ảnh, gửi `images: [{ data, mimeType }]` |
| `acceptTask` / `discardTask` (`src/foreman.js:1262`, `:1295`) | xoá thư mục task | xoá ảnh đã chép vào workspace |
| Hook `foreman-session-context.sh` | chỉ đọc `prompt`, `cwd` | ghi lại `transcript_path` / `session_id` để CLI tìm ảnh |

## Thiết kế

### 1. Bắt ảnh từ phiên Foreman

Model không tự xuất được byte ảnh, nên byte phải lấy từ chỗ client lưu.
Cả hai client đã chạy hook `UserPromptSubmit` của Foreman (`.claude/settings.json`, `.codex/hooks.json`), và payload của hook có `session_id` và `transcript_path`.

Đề xuất hai lớp:

- **Lớp chung, luôn có**: `--image <PATH>`, lặp được. Dùng khi ảnh đã là file, ví dụ ảnh kéo-thả (Claude Code chèn đường dẫn), hoặc file tạm Codex tạo khi dán.
- **Lớp tự động**: `--image pasted` lấy các ảnh trong lượt nhắn gần nhất của user ở phiên Foreman hiện tại.
  - Hook `session context` ghi `{ sessionId, transcriptPath, client, at }` vào `data/sessions/current.json` mỗi lượt (kể cả khi không có gì để báo).
  - Khi chạy `--image pasted`, CLI đọc transcript lúc đó (lượt của user chắc chắn đã được ghi), tìm các khối ảnh của user message mới nhất (Claude Code: block `image` base64 trong JSONL; Codex: `input_image` trong rollout), rồi lưu ảnh.
  - Không tìm thấy ảnh thì báo lỗi, không gửi gì. Foreman không bao giờ ngầm bỏ ảnh.

Bước 0 (spike) phải kiểm chứng trên cả Claude Code và Codex: đúng field trong payload hook, định dạng ảnh trong transcript, và thời điểm transcript được ghi.
Nếu một client không có ảnh trong transcript, client đó chỉ dùng lớp `--image <PATH>`, và skill hướng dẫn cách lấy đường dẫn.

### 2. Lưu ảnh (`src/attachments.js`, module mới)

```text
data/tasks/T-000123/
├── attachments/
│   ├── A-3f9c2e1a7b04.png      tên = "A-" + 12 ký tự đầu của sha256
│   └── A-91d0aa45c2e7.jpg
└── attachments.json            manifest có version
```

Mỗi mục trong manifest: `id`, `sha256`, `mimeType`, `bytes`, `source` (`pasted` hoặc `file`), `createdAt`, và nơi gắn: `{ round }`, `{ messageId }` hoặc `{ decisionId }`.

Kiểm tra khi nhận:

- loại ảnh xác định từ magic bytes, chỉ nhận PNG, JPEG, GIF, WebP;
- tối đa 5 MB một ảnh, tối đa 10 ảnh một tin nhắn (để hằng số, chỉnh sau);
- cùng sha256 trong một task thì dùng lại file đã có.

Ảnh được lưu trước khi có message nào được tạo, đúng §5.6/§7.3 ("persisted before runtime delivery").
Round record, decision record và payload message chỉ mang **tham chiếu** (`id`, `sha256`, `mimeType`, đường dẫn trong workspace), không mang byte.
Nhờ đó `payloadDigest` vẫn phủ cả ảnh, còn file `data/messages/*.json` vẫn nhỏ.

### 3. Giao ảnh cho worker

**Chung cho cả hai backend**: ngay trước khi tạo message, Foreman chép ảnh vào

```text
<workspace>/.foreman/attachments/<taskId>/<id>.<ext>
```

và thêm `/.foreman/` vào file exclude cục bộ của Git (`git rev-parse --git-path info/exclude`, chạy được với worktree).
Đây là file của riêng máy này, không được commit, nên ảnh không bao giờ lọt vào repo.
Dự án `vcs: none` thì chỉ chép, không có exclude.

Lý do chọn workspace:

- worker không được đọc `data/` của Foreman;
- worker chỉ làm trong workspace được cấp, và Claude Code, Codex, OpenCode đều đọc được ảnh bằng tool đọc file trong cwd mà không cần quyền thêm;
- worker thay thế cùng workspace nên thấy luôn ảnh cũ.

**Herdr**: chỉ dùng cách trên. Prompt ghi đường dẫn tuyệt đối.

**Paseo**: dùng cách trên, và thêm ảnh của tin nhắn hiện tại vào `agent.send(prompt, { messageId, images })`.
Bridge đọc file từ `data/tasks/<id>/attachments/`, kiểm tra lại sha256, rồi mới gửi.
Sai digest hoặc thiếu file thì báo lỗi trước khi gửi, nên message thành `failed` theo đúng luồng hiện có.

### 4. Prompt

Chỉ khi có ảnh, `deliveryPrompt` thêm một mục ngay sau phần yêu cầu của chính lượt đó:

```text
## Images for this request (round 2)
Open each image before you start; they are part of the user's request.
- /abs/workspace/.foreman/attachments/T-000123/A-3f9c2e1a7b04.png
- /abs/workspace/.foreman/attachments/T-000123/A-91d0aa45c2e7.jpg
```

- `task-brief`: tiêu đề là `Images for this request`; khi có `nextRequest` thì có thêm mục ảnh của round đó.
- `task-update`: `Images for this request (round N)`.
- `foreman-message`, `human-decision`: `Images`.
- Handoff: mỗi round trong `rounds` có `images: [đường dẫn]`, nên mục `Previous work and handoff` liệt kê ảnh của từng round.

Không có ảnh thì không có mục nào, và prompt giữ nguyên như hiện tại.
SPEC §7.7 thêm mục tuỳ chọn này vào template cố định.

### 5. Tính bền và retry của outbox

- Message không bao giờ được gửi lại; điều này không đổi.
- Thứ tự trong lock: lưu ảnh, chép vào workspace, tạo message (payload có tham chiếu ảnh), rồi gửi.
- Chép vào workspace lỗi: dừng trước khi tạo message, không có gì được gửi.
- Gửi không chắc chắn: xử lý như hiện tại (`deliveryUnverified`, `failed`), ảnh vẫn nằm trong task và workspace.
- `continueTask` lỗi thì round thành `failed`, ảnh gắn round đó vẫn được giữ lại làm bằng chứng.

### 6. Dọn dẹp

`acceptTask` và `discardTask` xoá thư mục task (gồm ảnh), và xoá thêm `<workspace>/.foreman/attachments/<taskId>/`.
Dòng exclude vẫn được giữ lại vì vô hại.
Xoá thư mục ảnh lỗi thì chỉ báo warning, không chặn acceptance.

### 7. CLI

Thêm `--image <PATH|pasted>` (lặp được) cho:

| Lệnh | Ảnh gắn với |
| --- | --- |
| `task create` | round 1 |
| `task brief` | round 1, thay ảnh cũ khi có `--image` (tuỳ chọn) |
| `task continue` | round mới |
| `task reassign --text` | `nextRequest` |
| `task message` | message |
| `decision answer` | decision; `decision deliver` gửi kèm |

Kết quả JSON của mỗi lệnh có thêm `attachments: [{ id, mimeType, bytes }]`, để Foreman báo lại cho bạn số ảnh đã gửi.

### 8. Skill và SPEC

- `.agents/skills/foreman-control/SKILL.md`: khi tin nhắn của user có ảnh, luôn truyền `--image pasted` (hoặc đường dẫn); khi xin xác nhận thì ghi "kèm N ảnh"; không bao giờ mô tả lại ảnh thay cho việc gửi ảnh. Tên và mô tả skill không đổi, nên `.claude/skills/` không cần sửa.
- `SPEC.md`: §5.6 (ảnh là một phần lời user, lưu trước khi gửi), §7.3 (`attachments/`, `attachments.json`), §7.7 (mục `Images`, payload chỉ mang tham chiếu), §9.2 (brief mang ảnh của round hiện tại và đường dẫn ảnh các round trước), §11.8 (`.foreman/attachments/` trong workspace), §20 (trạng thái).
- `docs/architecture.md`, `docs/runbook.md`: luồng ảnh và cách kiểm tra.

## Thứ tự implement

1. **Spike (bước 0)**: kiểm chứng payload hook và định dạng ảnh trong transcript của Claude Code và Codex; kiểm chứng `@getpaseo/client@0.11.1` `agent.send` với `images` trên từng provider (claude, codex, opencode).
2. `src/attachments.js`: nhận ảnh, kiểm tra, manifest, chép vào workspace kèm exclude, dọn dẹp. Có test riêng.
3. Nối vào core: `createTaskUnlocked`, `assignTask`, adopt, `deliverWorkerMessageUnlocked`, `continueTask`, `answerDecision`/`deliverDecision`, `reassignWorker` và `buildHandoffPackage`.
4. `deliveryPrompt`: mục `Images`, kèm test chứng minh prompt không ảnh giữ nguyên.
5. Paseo: `PaseoAdapter.send` nhận `options.images`, bridge đọc file, kiểm digest, gửi `images`.
6. CLI `--image` và lớp `pasted` (hook ghi `data/sessions/current.json`, đọc transcript).
7. Skill, SPEC, docs.
8. `npm test` xanh.

## Test

- `test/attachments.test.js` (mới): magic bytes, giới hạn, dedupe, manifest, exclude với repo thường và worktree, dự án `vcs: none`, dọn dẹp khi accept/discard.
- `test/task-rounds.test.js`: ảnh với `task create`, `task continue`, `task reassign --text`; round lỗi vẫn giữ ảnh; handoff liệt kê ảnh theo round.
- `test/herdr-adapter.test.js`: prompt có đường dẫn, và Herdr vẫn chỉ nhận text.
- `test/paseo.test.js`: runner nhận `images` với đúng base64 và mimeType; sai digest thì message `failed` và không gửi.
- Test hồi quy: payload và prompt khi không có ảnh trùng khớp với hiện tại.
- Test parser transcript với fixture JSONL của Claude Code và Codex (lấy từ spike).

## Rủi ro và điểm chưa kiểm chứng

- **Transcript**: định dạng transcript không phải API công khai và có thể đổi. Parser cần chặt và báo lỗi rõ, và `--image <PATH>` luôn là lối dự phòng.
- **Worker không đọc được ảnh**: model không có vision (ví dụ một số model OpenCode) chỉ thấy đường dẫn. Prompt yêu cầu mở ảnh; nếu không mở được, worker phải báo trong report. Router có thể ưu tiên profile có vision khi task có ảnh, nhưng việc đó để sau.
- **Workspace dùng chung**: nhiều task cùng dự án có thư mục `<taskId>` riêng, nên không đè nhau.
- **Kích thước bridge**: ảnh base64 đi qua stdin của bridge; cần đặt giới hạn tổng và kiểm `maxBuffer`.

## Cần chốt

1. Chỗ đặt ảnh trong workspace: `.foreman/attachments/<taskId>/` cộng với `.git/info/exclude` (đề xuất), hay một thư mục ngoài workspace mà worker được cấp quyền đọc?
2. Với Paseo, gửi kèm ảnh inline **và** file trong workspace (đề xuất, vì handoff và các round sau cần file), hay chỉ inline?
3. Có làm lớp `--image pasted` ngay, hay giao trước `--image <PATH>` rồi làm lớp tự động sau spike?
4. Giới hạn 5 MB/ảnh và 10 ảnh/tin nhắn có ổn không?
