# StatusLabel

Nhãn trạng thái task dạng viên thuốc: chấm màu + chữ thường trên nền nhạt, viền mảnh cùng tông — đọc được khi quét dọc một cột.

- `status` là `meta.status` của Foreman, nguyên văn: `waiting-decision`, `blocked`, `review-ready`, `working`, `pending`, `routing`, `queued`, cộng `choose-model` khi `needsProfileConfirmation`.
- Tông cố định theo nhóm: **đỏ** chờ bạn · **xanh dương** agent giữ · **mực** chưa giao · **xanh lá** chờ duyệt. Không tự đặt tông khác cho cùng một trạng thái.
- `tone` + children cho nhãn tự do (report `done`, “quá 24 giờ”). `size="sm"` trong bảng và danh sách.
- Trạng thái runtime là trục khác — dùng `RuntimeBadge`, không nhét vào nhãn này.
