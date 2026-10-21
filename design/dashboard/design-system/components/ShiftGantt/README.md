# ShiftGantt

Biểu đồ ca làm việc: mỗi task một dòng, các đoạn trạng thái theo thời gian, vạch “BÂY GIỜ”.

- `rows`: `{id, segs:[{from, to, kind, label}]}`; `kind`: `run` · `idle` (xong lượt, chờ round tiếp) · `you` · `review` · `warn` · `queue`.
- Dựng lại từ thời điểm round, report, quyết định, bất thường — là ước lượng, ghi rõ điều đó trong lede của màn.
