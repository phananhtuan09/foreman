# WorkerSlot

Một agent đang chạy: mã task, tiêu đề, profile · round, backend, runtime, thời gian từ hoạt động cuối và thanh so với ngưỡng.

- `quietRatio` = thời gian không hoạt động / ngưỡng (90 phút); thanh vàng và chữ đậm khi vượt ngưỡng; thẻ có bất thường tô nền vàng nhạt hoặc có bất thường (`quietWarn`, `tone="mustard"`).
- Bấm để chọn task (đồng bộ với dòng trong `FleetTable`). Chấm xanh khi có report mới chưa xem.
- Dùng trong `LaneGroup`; dưới 640px các thẻ cuộn ngang.
