# InboxList

Danh sách việc chờ bạn, nhóm theo loại, lâu nhất trước: mã, câu hỏi, tuổi chờ, trạng thái, dự án.

- `groups`: `{key, label, items:[{key, id, question, age, urgent, overdue, isNew, status, project}]}`; `current`, `onPick`.
- Tuổi chờ đỏ khi việc thuộc nhóm đỏ; “quá hạn” khi chờ hơn 24 giờ.
