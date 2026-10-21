# TopBar

Bìa sổ: thanh tối (`chrome`) dính khi cuộn — ấn FM xoay viền kép, wordmark condensed + dòng phụ, các tab điều hướng, chỉ báo dữ liệu sống, nút tìm nhanh, theme và trợ giúp.

- Props: `nav` (mảng `{id, label, count?, tone?, countLabel?}` hoặc `{sep:true}`), `current`, `onNavigate`, `live` (props của `LiveIndicator`), `onSearch`, `onHelp`, `onTheme`, `theme`, `onHome`.
- Thứ tự tab cố định: Tổng quan · Chờ bạn · Timeline | Health · Dự án & lease · Token & cache · Cài đặt.
  Vạch ngăn tách nhóm theo dõi với nhóm hệ thống.
- Chỉ “Chờ bạn” (đỏ) và “Health” (vàng) mang số đếm.
  Không đếm gì khác trên tab.
- Tab đang mở là mép giấy (`surface`) nối liền với trang; tab khác chữ `chrome-2`.
- Dưới 1180px các tab xuống dòng riêng; dưới 1560px chỉ còn chấm của `LiveIndicator`.
