# CopyCommand

Khối copy: prompt tiếng Việt cho phiên Foreman (chính) và lệnh CLI tương ứng (phụ).

- Props: `text` (câu nói với Foreman, ví dụ “Duyệt T-38.”), `cli` (lệnh `foreman …`), `label`, `quiet`, `onCopied(value, failed)`.
- Người dùng làm việc qua agent, nên prompt luôn là lựa chọn đầu; CLI chỉ để tham khảo hoặc khi chạy tay.
- Gọi `onCopied` để bật `Toasts`; khi copy thất bại, toast in nguyên văn để người dùng tự chọn.
