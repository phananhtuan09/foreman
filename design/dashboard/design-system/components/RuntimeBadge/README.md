# RuntimeBadge

Trạng thái runtime của agent từ lần status check gần nhất: chấm + chữ mono.

- `state`: `working` (nhấp nháy) · `idle` · `waiting-input` · `unknown` · `mismatch` · `dead` · `missing` · `none` (chưa có agent).
- `unknown` luôn vàng, không bao giờ đỏ: Foreman không suy ra agent đã chết từ bằng chứng không rõ.
- Luôn đặt cạnh `BackendTag`; không dùng thay `StatusLabel`.
