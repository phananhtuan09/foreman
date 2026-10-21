Foreman Manifest là giao diện **theo dõi, chỉ đọc** của đội agent Foreman, chạy cục bộ bằng `foreman dashboard serve`.
Người dùng vẫn ra lệnh cho Foreman qua agent trong repo.
Dashboard trả lời ba câu hỏi theo thứ tự: *việc gì đang chờ tôi*, *agent nào đang chạy và có ổn không*, *vừa xảy ra chuyện gì*.
Mọi hành động chỉ **copy** câu cần nói với Foreman.

## Các màn hình

| Tab | Mục đích | Thành phần chính |
| --- | --- | --- |
| Tổng quan (mặc định) | Thấy mọi agent và task trên một màn | `CounterBar`, `LaneGroup` + `WorkerSlot`/`HeldChip`, `FleetTable`, `Pane` |
| Chờ bạn | Xử lý từng việc chờ bạn, lâu nhất trước | `InboxList`, `DecisionOptions`, `Report`, `Compose`, `NextBox` |
| Timeline | Thời gian đi đâu, vừa xảy ra gì | `ShiftGantt`, `KpiStrip`, `EventLog` |
| Health | Foreman có đang giám sát đúng không | `CheckList`, bảng bất thường, thông báo chưa báo, hộp thư đi |
| Dự án & lease | Ai giữ tài nguyên nào, chồng lấn, phụ thuộc | `Card` + `Meter`, bảng lease |
| Token & cache | Chi phí, xem theo tuần (không thuộc luồng điều phối) | `KpiStrip`, `DailyBars`, `HitLine`, `BarList` |
| Cài đặt | Tùy chọn hiển thị, profile định tuyến, nguồn dữ liệu, phím tắt | `Toggle`, `Segmented`, `KeyValue`, `KeyHelp` |
| Trang task (`#/task/T-41`) | Mọi round, report nguyên văn, quyết định, attention, lease | `Tabs`, `RoundList`, `NextBox`, `Card` |

- Thứ tự tab và tên tab cố định như trên.
- Chỉ hai tab mang số đếm: Chờ bạn (đỏ) và Health (vàng).
- Mỗi màn bắt đầu bằng `PageHeader`, có `lede` trả lời câu hỏi chính của màn trong một câu.

## Giọng văn

- Câu và nhãn hành động viết **tiếng Việt**.
  Mã, đường dẫn, lệnh, profile giữ nguyên văn: `T-41`, `codex-luna`.
- **Giữ tiếng Anh** cho từ dev quen dùng hoặc là khái niệm của Foreman — dịch ra khó hiểu hơn: agent, task, round, report, prompt, dispatch, routing, profile, lease, workspace, endpoint, attention, outbox, notice, accept, promote, scout/ship.
  Hai màn cũng giữ tên tiếng Anh: **Timeline**, **Health**.
- Trạng thái runtime giữ giá trị Foreman (`running`, `idle`, `waiting input`, `unknown`, `dead`, `missing`); trạng thái task viết tiếng Việt (Cần quyết định, Bị chặn, Chọn model, Chờ duyệt, Đang làm, Đang dispatch, Đang routing, Chờ dispatch) — hai trục không lẫn nhau.
- Gọi người dùng là **bạn**, gọi Foreman là **Foreman**.
- Thời gian ghi tương đối kèm đơn vị: “chờ bạn 26 giờ”, “12 phút trước”.
  Giờ tuyệt đối dùng mono: `10:39:12`.
- Prompt cho Foreman là câu ngắn có mã task ở đầu:
  - “Accept T-38.”
  - “T-42: chọn phương án A cho D-1.”
  - “T-41: làm theo hướng 1.”

  Lệnh CLI chỉ là phương án phụ, nằm ngay dưới prompt.
- Không viết như thể dashboard tự làm.
  Nút luôn là “Copy …”, “Mở …”, “Xem …”.
- Không giải thích lại cơ chế Foreman trên màn hình (lede, hint, chú thích).
  Chỉ ghi điều người dùng cần để quyết định, ví dụ hậu quả của accept.
  “Dashboard chỉ đọc” chỉ nói một lần ở footer.
- Khi chưa có số liệu thật thì hiện “—” và nói lý do.
  Không bao giờ hiện số đoán.
- Nhãn, nút và nội dung viết **chữ thường kiểu câu** (“Copy prompt”, “Mở task”).
  In hoa nén chỉ dành cho tiêu đề ngắn theo giọng sổ (xem Chữ), không dùng cho câu.

## Hai trục trạng thái

**Trạng thái task** dùng `StatusLabel`.
Giá trị là `meta.status` nguyên văn, cộng `choose-model` khi `needsProfileConfirmation`.
Có ba nhóm:

- **Chờ bạn:** `waiting-decision`, `blocked`, `choose-model`, `review-ready`
- **Agent giữ:** `working`, `pending`
- **Chưa giao:** `routing`, `queued`

**Trạng thái runtime** dùng `RuntimeBadge`, lấy từ lần status check gần nhất.
Các giá trị: `working`, `idle`, `waiting-input`, `unknown`, `mismatch`, `dead`, `missing`.
Bất thường (`worker.idle-without-report`, `worker.waiting-input`, `worker.timeline-gap`…) lấy nhãn và giải thích từ `Foreman.ISSUE`.

`FleetTable` gom mỗi task vào đúng **một** nhóm, ưu tiên theo thứ tự:

1. **Chờ bạn:** task thuộc nhóm chờ bạn.
2. **Bất thường:** task đang chạy nhưng có issue, runtime xấu, hoặc không hoạt động quá `90` phút.
3. **Đang chạy.**
4. **Hàng chờ.**

`unknown` luôn hiện màu vàng, không bao giờ màu đỏ.
Dashboard không bao giờ suy ra agent đã chết.

## Màu

Mỗi màu mang một nghĩa cố định; màu luôn đi kèm chữ.

- **`red` / `red-deep` / `red-tint`: chờ bạn.**
  Chấm đỏ, số đếm đỏ, nhãn “Cần quyết / Bị chặn / Chọn model”, tuổi chờ.
  Chữ đỏ dùng `red-deep`; nền nhạt dùng `red-tint`.
- **`mustard` / `mustard-deep` / `mustard-tint`: Foreman thấy bất thường** (chờ input, idle mà chưa report, không hoạt động lâu).
  `mustard` cho chấm và thanh; chữ dùng `mustard-deep`; thẻ bất thường tô `mustard-tint`.
- **`blue` / `blue-tint`: đang chạy**, báo cáo mới (`fm-newdot`), liên kết và focus.
- **`green` / `green-tint`: xong** (`review-ready`, report “Xong”) và kết nối đang sống.
- **`ink-tint`: trung tính** (`routing`, `queued`, tag dự án).

Nền và chữ:

- `chrome` / `on-chrome` / `chrome-2`: bìa sổ — nền tối của top bar, chữ trên bìa và tab chưa chọn.
  Tab đang mở lấy màu `surface`, như mép giấy thò ra khỏi bìa.
- `surface` là nền trang (giấy ngà).
  `surface-raised` cho mọi khối: thẻ, bảng, pane, input.
  `surface-sunken` cho đầu bảng và tiêu đề nhóm.
- `surface-hover` khi hover; `surface-selected` cho dòng/thẻ đang chọn, kèm vạch `ink` 3px bên trái.
- Chữ chính `ink`, chữ phụ `ink-2`, nhãn và thời gian `ink-3` — đều đạt ≥ 4.5:1 trên mọi nền ở cả hai theme.
- `line` cho đường chia mảnh; `line-strong` cho viền điều khiển và dòng kẻ gạch đứt của bảng — ≥ 3:1; `sheet-edge` cho viền sổ của bảng, bộ đếm, pane.

Hai theme dùng chung tên token: **Ca ngày** (`light`, giấy ngà, mặc định) và **Ca đêm** (`dark`, nền than).
Dashboard theo `prefers-color-scheme`; người dùng ghim được trong Cài đặt.

## Chữ

Hai giọng chữ, mỗi giọng một việc:

- **Giọng sổ — `display` (Barlow Condensed, in hoa, đậm)** cho những thứ ngắn để *định vị*: wordmark, tiêu đề trang (34px), tiêu đề mục (20px, kèm đường kẻ sổ), đầu cột bảng (13px, giãn chữ), mã task (18px), con số bộ đếm và KPI (40px), tiêu đề round, chữ trên con dấu.
  Không bao giờ dùng cho câu văn.
- **Giọng đọc — `sans` (IBM Plex Sans, có subset tiếng Việt)** cho mọi thứ người dùng *đọc*: 14px giao diện, 15px khi đọc nội dung dài (report, quyết định, lời bạn dặn), 13px dòng phụ, 12px nhãn.
  Chữ thường kiểu câu, kể cả nút và nhãn trạng thái.
- `mono` (IBM Plex Mono) **chỉ** cho định danh máy: đường dẫn, lệnh, endpoint, lease key, profile.
- Số dùng tabular (`font-variant-numeric: tabular-nums`) để cột thẳng hàng.
- Khi chạy thật, `foreman dashboard serve` tự host file woff2 vì dashboard phải chạy được trên localhost khi không có mạng.

## Khoảng cách, viền, bóng

- Lưới cơ sở 4px (`space-1`…`space-8`); khoảng cách giữa các khối 12–24px.
- Viền: 1px (`bw-hair`) cho thẻ và điều khiển; 1.5px (`bw-ledger`, màu `sheet-edge`) cho bảng, bộ đếm, pane — viền “sổ”; dòng trong bảng ngăn bằng gạch đứt; 2px (`bw-strong`) cho focus; 3px (`bw-bar`) cho vạch chọn; 3px kép (`bw-double`) chỉ cho con dấu và ấn FM.
- Bo góc: `radius-md` 8px cho thẻ, bảng, pane; `radius-sm` 6px cho nút, input; `radius-lg` cho hộp thoại; `radius-pill` cho nhãn trạng thái, chip, số đếm.
- Bóng: `raise` (bóng cứng 2px, không nhòe) cho nút có viền và phương án được đề xuất — như tem dán lên sổ.
  `shadow-md` cho toast, `shadow-lg` cho hộp thoại và ngăn kéo.
  Thẻ phẳng.

## Chi tiết nhận diện

Nhận diện “phiếu kho” nằm ở **khung**, không nằm dưới chữ:

- Top bar là bìa sổ tối; ấn **FM** tròn viền kép xoay −6°; hàng lỗ đục (`Perforation`) ngay dưới, dính theo khi cuộn.
- Vân giấy rất nhẹ trên nền (`Sheet grain`), tắt được bằng `grain={false}`.
- Số mục trang (`01`…`07`) là chip mực cạnh eyebrow.
- Sọc cảnh báo chỉ là **dải 5px ở mép trên** bộ đếm đỏ/vàng khi có giá trị — không bao giờ làm nền cho chữ.
- `Stamp` (con dấu xoay, viền kép, in hoa) **tối đa một cái mỗi màn**, cho kết luận của trang: “BỊ CHẶN” trên trang task, “3 MỤC CẦN XEM” ở Health.

## Tương tác

- **Focus:** viền 2px liền màu `focus`, cách 2px, trên mọi phần tử bấm được.
  Dòng trong bảng và mục trong danh sách cũng nhận focus.
- **Chọn:** một task chọn ở bảng sẽ chọn luôn ở agent và mở trong `Pane`.
  Màn hẹp hơn `bp-desktop` thì mở trong `Drawer`.
- **Bàn phím:**
  - Ctrl K hoặc `/` để tìm nhanh, `?` để xem phím tắt.
  - `G` rồi một chữ cái để đi tới màn.
  - `J`/`K` để đi qua task; `Enter` để xem, `Shift Enter` để mở trang task.
  - `C` để copy prompt đề xuất.
- **Báo cáo mới chưa xem:** có chấm xanh, mất khi người dùng chọn task đó.
  Số việc chờ bạn hiện trên tiêu đề tab.
- **Thông báo trình duyệt:** tùy chọn, chỉ báo việc cần bạn và bất thường.

## Dữ liệu sống và trạng thái hệ thống

- `LiveIndicator` trong `TopBar` có bốn trạng thái: `live` (SSE), `stale` (poll 5 giây), `reconnecting`, `offline`.
- Khi `offline` hoặc `reconnecting`, thêm `Banner` ở đầu trang và ghi giờ của số liệu đang hiện.
- Khi chưa có snapshot đầu tiên, hiện `Skeleton` tối đa 1 giây.
- Khi `Snapshot.state` khác `ready`, thay cả màn bằng `StateNotice` và nói rõ người dùng cần làm gì.
- Task Foreman bỏ qua vì sai schema được liệt kê ở màn Health, phần còn lại vẫn hiện.
- Task đã accept hoặc discard chỉ còn một dòng trong `data/task-history.jsonl` (mã, dự án, outcome, mốc thời gian; không nội dung).
  Timeline hiện các dòng này; tiêu đề chỉ có khi dashboard từng thấy task lúc còn mở.

## Bố cục

- Nội dung rộng tối đa `sheet-max`, căn giữa.
- Từ `bp-desktop` trở lên, `Pane` rộng `peek-width` nằm cạnh bảng; dưới mức đó nó mở thành `Drawer`.
- Dưới 1180px, các tab xuống dòng riêng.
- Dưới `bp-tablet`:
  - Bộ đếm xếp 2×2.
  - `FleetTable` chuyển sang `layout="cards"`.
  - Lưới 2–3 cột còn 1 cột.
- Dưới `bp-phone`, agent cuộn ngang.

## Biểu tượng

Hệ thống không có bộ icon.
Các ký tự Unicode sau có nghĩa cố định và luôn đi kèm chữ hoặc `aria-label`:

- `▸`/`→` đi tới
- `↗` mở trang
- `⌕` tìm
- `✕` đóng
- `▲` cao nhất
- `✓ ! ✕ –` dùng trong `CheckList`
- `☾ ☀` đổi theme
- `·` ngăn cách các mục meta

Không dùng emoji.
Logo là vòng tròn chữ “FM” cạnh wordmark “FOREMAN”, dựng bằng CSS (`.fm-seal`).

## Dùng các component

Bundle gán `window.Foreman` và cần React 18 trên trang.
Nạp theo thứ tự: tokens.css, `components/bundle.css`, React, ReactDOM, rồi `components/bundle.js`.

Ngoài component, `window.Foreman` còn có:

- Từ vựng: `STATUS`, `STATUS_ORDER`, `RUNTIME`, `ISSUE`/`issueOf`, `EVENT`, `POINT_KIND`.
- Hàm thời gian tiếng Việt: `dur`, `ago`, `clock`, `dayLabel`…
- `copyText`.

`STATUS` phản chiếu `taskStamp()` trong `paseo-plugins/foreman-dashboard/shared/status.ts`; thêm trạng thái mới thì sửa cả hai nơi.

`AppShell` là màn hình hoàn chỉnh dựng từ các component này, dùng dữ liệu mẫu theo đúng hình dạng state của Foreman.
Nó có bảng “Bản thiết kế” để giả lập sự kiện, và ghi chú về dữ liệu server cần cung cấp.
