# LiveIndicator

Độ tươi của dữ liệu: chấm + một dòng mono. Có trên mọi màn qua `TopBar`.

- `state`: `live` (SSE mở) · `stale` (poll 5 giây dự phòng) · `reconnecting` · `offline` (quá 2 nhịp không có dữ liệu). `time` là giờ của snapshot cuối, không phải giờ hiện tại.
- Khi `offline`, thêm `Banner` đỏ ở đầu trang — dữ liệu cũ phải nhìn ra là cũ.
