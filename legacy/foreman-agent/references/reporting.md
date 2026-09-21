# Báo cáo

Playbook của `foreman-agent`.
Nạp khi Human hỏi về một item cụ thể, xin status đầy đủ, hoặc ngay sau khi bạn xong một thao tác.

Báo cáo mặc định bốn nhóm nằm ở `SKILL.md` và luôn có sẵn; file này sở hữu mọi khối chi tiết hơn nó.
Luật `## Độ dài và mức chi tiết` trong `SKILL.md` áp cho tất cả khối dưới đây.

## Một response, một representation

Mỗi item chỉ xuất hiện một lần trong cùng response.
Nếu đã in khối chi tiết cho `T-41`, không lặp `T-41` trong digest hay báo cáo mặc định ở cuối lượt.

Khi một item khác vừa cần attention trong lúc đang trả lời, đặt nó dưới heading phù hợp bằng một bullet ngắn.
Không chen chronology như `trong lúc bạn hỏi`, vì thời điểm xuất hiện không đổi việc Human cần làm.

Luôn xếp nội dung theo thứ tự:

1. trạng thái hoặc action cần Human;
2. kết luận giúp Human quyết;
3. verification chưa hoàn tất và rủi ro còn mở;
4. chi tiết bổ sung chỉ khi Human đã hỏi.

## Status đầy đủ

Human xin status tất cả thì mỗi item `[~]` chiếm một bullet.
Ghi nguồn một lần và kèm thời điểm snapshot.

```markdown
### Đang chạy

- `T-21` · Đang chạy · cập nhật 14:20.
  Theo @codex-1: đã tái hiện callback trùng; đang thêm idempotency guard; tiếp theo chạy regression.
```

Chỉ tách item thành nhiều dòng nếu có blocker, verification gap hoặc rủi ro mà Human cần thấy ngay.
Item `[v]` trong cùng lượt dùng review package bên dưới và không xuất hiện trong nhóm `Đang chạy`.

## Một item đang chạy

Human hỏi về đúng một item thì dùng snapshot mới nhất; thiếu field họ cần thì query worker trước theo `worker-io.md`.

```markdown
`T-21` · Đang chạy · @codex-1 · cập nhật 14:20

Theo @codex-1: đã tái hiện callback trùng và đang thêm idempotency guard.
Tiếp theo: chạy regression test.
Chưa kiểm tra: regression test.
```

Bỏ dòng không có giá trị thay vì in `-`, `none` hoặc lặp lại trạng thái.
Nếu worker tự xử lý blocker, thay dòng `Cần bạn` bằng `Đang tự xử lý: <blocker và cách gỡ>`.
Nếu claim chỉ dựa trên worker, attribution ở dòng `Theo @agent` áp cho toàn khối.
Không thêm summary lặp lại chính các dòng phía trên.

## Review package

Item `[v]` mặc định chỉ chiếm một bullet trong báo cáo mặc định.
In khối đầy đủ ở đúng hai lúc: Human hỏi về chính item đó, hoặc Human yêu cầu status đầy đủ.
Item vừa vào `[v]` không phải là một trong hai lúc đó.

```markdown
`T-34` · Chờ duyệt · @koken-1 · hoàn tất 09:51

Kết luận: Theo @koken-1, 10/10 cron job chạy đúng trên hai server và không phát hiện bug mới.
Đã kiểm tra: log, DB, mail, FTP và remote check.
Chưa kiểm tra: test tự động.
Còn mở: một lỗi lịch sử ngoài phạm vi đã tự phục hồi và chưa tái diễn.
```

Khối này là bản rút gọn, không phải bản chép lại Completion Package.
Dòng `Kết luận` phải trả lời điều Human quan tâm nhất; correction, observable result và thay đổi quan trọng được gộp vào đây thay vì tạo thêm field IN HOA.

- Bỏ hẳn thông tin không giúp duyệt, như `không sửa file`, `public contract: none` hoặc `rủi ro: không`.
- Verification đã pass thì đếm hoặc gom; verification chưa chạy phải nói rõ.
- Rủi ro chỉ lấy từ worker report; nghi vấn đã loại trừ thì bỏ.
- Nhiều rủi ro cùng loại thì gộp; các decision khác nhau mà Human phải chọn thì giữ thành bullet riêng.
- Không thêm đánh giá chất lượng hay khuyến nghị duyệt của Foreman.

Nếu còn một lựa chọn product, business, architecture, security, compatibility hoặc operational mà Human phải chốt, item chưa sẵn sàng để duyệt.
Trình nó bằng Decision package thay vì giấu lựa chọn dưới `Còn mở` của Review package.

Human muốn đủ chi tiết thì đọc snapshot gốc và trả lời đúng phần họ hỏi, không in toàn bộ package mặc định.

## Decision package

Khi cần Human quyết, trình bày decision trực tiếp và giữ đủ option, impact cùng recommendation của worker.

```markdown
`T-12` · Cần bạn quyết

Vấn đề: Có hai behavior hợp lệ cho refresh token và repository chưa có authority để chọn.

- A — Reuse token: giữ tương thích, nhưng tiếp tục chấp nhận replay window hiện tại.
- B — Rotate token: giảm replay window, nhưng client cũ phải xử lý token mới sau mỗi refresh.

Theo @claude-2, khuyến nghị B vì phù hợp security goal đã nêu.
Bạn chọn A hay B?
```

Không nén option, impact hoặc recommendation thành một câu nếu làm mất tradeoff.
Trong toàn response chỉ hỏi Human một câu.

## Item chi tiết cùng item mới

Nếu Human đang hỏi sâu về `T-41` và `T-42` vừa cần duyệt, response có đúng hình dạng sau:

```markdown
`T-41` · Cần bạn quyết

Vấn đề: Legacy đang chấp nhận hai định dạng mã và cần chốt phạm vi sửa trước khi worker tiếp tục.

- A — Chỉ sửa New: ít ảnh hưởng hơn, nhưng Legacy vẫn giữ hai định dạng.
- B — Sửa cả New và Legacy: thống nhất behavior, nhưng có thể cần rà hoặc backfill dữ liệu cũ.

Theo @koken-1, khuyến nghị B để tránh tiếp tục sinh dữ liệu không đồng nhất.
Bạn chọn A hay B?

### Cần bạn duyệt

- `T-42` Demo slice mask — Theo @koken-2: demo và tài liệu đã xong; cần người có domain xác nhận.
```

Không lặp `T-41` trong nhóm `Cần bạn quyết` ở cuối response.
Không thêm câu kể rằng `T-42` xuất hiện trong lúc đang trả lời.

## Xác nhận sau thao tác

Duyệt, từ chối, giao việc, relay decision và requeue đều báo đúng một dòng.

```text
Đã duyệt T-34; @koken-1 đang nhận T-36 tiếp theo.
```

Ví dụ giao việc:

```text
Đã giao T-14 cho @codex-1.
```

Ví dụ nhận quản lý worker đang chạy:

```text
Đã nhận quản lý T-14 từ @koken-1; observer đang theo dõi từ trạng thái hiện tại.
```

Không in raw prompt đã gửi trừ khi Human yêu cầu xem prompt.
Không kể `done.md`, snapshot, trace, event hay dependency không thay đổi action của Human.

Sau xác nhận, chỉ thêm các item khác đang cần Human xử lý.
Không in lại item vừa được xác nhận và không in toàn bộ báo cáo mặc định chỉ để chứng minh state đã đổi.

## Cấm

- Không lặp cùng một item ở cả khối chi tiết và digest trong một response.
- Không dùng nhãn IN HOA kiểu transcript cho output gửi Human.
- Không kể chronology hoặc housekeeping không đổi action của Human.
- Không liệt kê từng verification đã pass; đếm chúng và chỉ kể phần chưa chạy.
- Không in field rỗng hay field `none` chỉ để khối đủ dáng.
- Không thêm đánh giá chất lượng hay khuyến nghị duyệt của Foreman.
