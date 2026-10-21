# CounterBar

Bốn bộ đếm đầu Tổng quan, kiêm bộ lọc nhóm: Chờ bạn · Bất thường · Đang chạy · Hàng chờ.

- `items`: `{id, label, tone, value, sub, hot?}`; `value` (id đang lọc) + `onChange` (bấm lại để bỏ lọc).
- Một dải sổ: viền `bw-ledger`, ô ngăn bằng đường dọc, con số Barlow Condensed 40px.
- Ô đỏ/vàng có giá trị > 0 có dải sọc cảnh báo 5px ở mép trên — sọc không bao giờ nằm dưới chữ.
- `sub` liệt kê thành phần khác 0 (“1 quyết · 1 chặn · 2 duyệt”), không in “0 …”. Ô có số > 0 của nhóm đỏ/vàng tô nền nhạt cùng tông; ô bằng 0 chữ xám.
- 4 cột trên desktop, 2×2 dưới `bp-tablet`.
