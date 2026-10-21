import React from '../ds/react.js';
import * as F from '../ds/components.jsx';

const H = ({ children }) => <div className="fm-h4" style={{ marginTop: 16 }}>{children}</div>;
const UL = ({ items }) => <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.55 }}>{items.map((x, i) => <li key={i} style={{ margin: '3px 0' }}>{x}</li>)}</ul>;

// What a reviewer needs to judge this design and what an implementer needs to build it.
export function DesignNotes() {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 14 }}>Bạn vẫn ra lệnh cho Foreman qua agent trong repo. Dashboard là nơi <b>theo dõi</b>: liếc là biết việc gì chờ bạn, agent nào đang chạy, có gì bất thường — rồi copy đúng câu cần nói với Foreman.</p>
      <H>Cấu trúc</H>
      <UL items={[
        <><b>Tổng quan</b> (màn chính): 4 bộ đếm kiêm bộ lọc · agent đang chạy (mỗi thẻ = một endpoint đang giữ task) · bảng mọi task chưa accept, nhóm theo việc cần làm: Chờ bạn → Bất thường → Đang chạy → Hàng chờ · khung xem nhanh bên phải (≥1360px) hoặc ngăn kéo.</>,
        <><b>Chờ bạn</b>: quyết định / bị chặn / chọn model / chờ duyệt / attention, lâu nhất trước; đọc đủ Decision Package, gợi ý của agent, soạn sẵn prompt.</>,
        <><b>Timeline</b>: thời gian theo task (agent làm hay chờ bạn) + nhật ký sự kiện.</>,
        <><b>Health</b>: status check, heartbeat Paseo, runtime, bất thường, notice chưa báo, outbox.</>,
        <><b>Dự án & lease</b>: dự án, slot đã dùng, ai giữ resource nào, chồng lấn, phụ thuộc.</>,
        <><b>Token & cache</b>: tách khỏi màn chính; đang là số liệu mẫu.</>,
        <><b>Cài đặt</b>: tùy chọn hiển thị (lưu ở trình duyệt), routing profile, nguồn dữ liệu, phím tắt.</>,
        <><b>Trang task</b> (<span className="fm-code">#/task/T-41</span>): mọi round + report nguyên văn, quyết định, attention, outbox, workspace, lease, phụ thuộc, handoff.</>
      ]} />
      <H>Thuật ngữ</H>
      <UL items={[
        <><b>Giữ tiếng Anh</b> khi đó là từ dev quen dùng hoặc là giá trị của Foreman: agent, task, round, report, prompt, dispatch, routing, profile, lease, workspace, endpoint, attention, outbox, notice, accept, promote, scout/ship, Timeline, Health.</>,
        <><b>Trạng thái runtime</b> giữ nguyên giá trị Foreman (running, idle, waiting input, unknown, dead, missing) để tách khỏi <b>trạng thái task</b> viết tiếng Việt (Cần quyết định, Bị chặn, Chọn model, Chờ duyệt, Đang làm, Đang dispatch, Đang routing, Chờ dispatch).</>,
        'Tiếng Việt cho câu và nhãn hành động: Chờ bạn, Bất thường, Hàng chờ, Quyết định, Phụ thuộc, Cài đặt.',
        'Không giải thích lại cơ chế Foreman trên màn hình; chỉ ghi hậu quả khi bấm (ví dụ accept xoá task). Không lặp “dashboard chỉ đọc”: đã có ở footer và hộp phím tắt.'
      ]} />
      <H>Phong cách — “sổ kho đọc được”</H>
      <UL items={[
        <><b>Nhận diện nằm ở khung</b>: thanh trên tối như bìa sổ, tab đang mở là mép giấy; hàng lỗ đục; con dấu FM xoay; vân giấy rất nhẹ; tiêu đề trang, tiêu đề mục, mã task và con số dùng Barlow Condensed in hoa.</>,
        <><b>Dữ liệu ưu tiên đọc</b>: nội dung, nút và nhãn dùng IBM Plex Sans chữ thường kiểu câu, 14–15px (dấu tiếng Việt rõ); mono chỉ cho mã, đường dẫn, lệnh.</>,
        'Bảng và bộ đếm có viền sổ 1.5px, dòng kẻ gạch đứt như sổ cái; nút có bóng cứng 2px như tem dán; trạng thái là viên thuốc viền mảnh cùng tông.',
        'Sọc cảnh báo chỉ là dải mỏng ở mép bộ đếm đỏ/vàng, không nằm dưới chữ. Con dấu xoay tối đa một cái mỗi màn, dùng cho kết luận (BỊ CHẶN, 3 MỤC CẦN XEM).',
        'Ca ngày nền giấy ngà, ca đêm nền than; mọi cặp chữ/nền ≥ 4.5:1.'
      ]} />
      <H>Quyết định thiết kế</H>
      <UL items={[
        'Hành động chính là “Copy prompt” (câu tiếng Việt dán vào phiên Foreman), CLI chỉ là phương án phụ — vì bạn làm việc qua agent, chạy CLI tay sẽ bỏ qua quy trình của phiên Foreman.',
        'Mỗi task hiện đúng một lần, ở nhóm việc cần làm nhất — giống báo cáo của Foreman (renderUserReport).',
        'Hai trục tách bạch: trạng thái task (meta.status) và trạng thái runtime. “unknown” không bao giờ được vẽ thành “dead”.',
        'Đỏ = chờ bạn · vàng = Foreman thấy bất thường · xanh dương = đang chạy · xanh lá = xong. Màu luôn đi kèm chữ.',
        'Không hiện số đoán: token chưa có nguồn thì hiện “—”; task đã kết thúc chỉ có tiêu đề nếu dashboard từng thấy nó lúc còn mở (task-history.jsonl không lưu nội dung).',
        'Báo cáo mới chưa xem có chấm xanh; số việc chờ bạn hiện trên tiêu đề tab; thông báo trình duyệt (tùy chọn) chỉ cho việc cần bạn và bất thường.',
        'Bàn phím: Ctrl K tìm nhanh · G rồi chữ cái để đi tới màn · J/K đi qua task · C copy prompt đề xuất · ? xem phím tắt.'
      ]} />
      <H>Dữ liệu server cần (ngoài taskSummaries hiện có)</H>
      <UL items={[
        <><b>Mỗi task</b>: <span className="fm-code">createdAt, statusSince, lastActivityAt, generation, owner, workspace, branch, resourceLease, dependencies</span> — có sẵn trong meta.json.</>,
        <><b>Vòng & report</b>: rounds/*.json và reports/* (status, thời điểm, summary, Next steps) — có sẵn trên đĩa.</>,
        <><b>Quyết định & điểm chờ</b>: decisions/*, attention.json — có sẵn.</>,
        <><b>Runtime & bất thường</b>: kết quả status check gần nhất (state + issues). Hiện chỉ có khi phiên Foreman chạy <span className="fm-code">status</span>; cần ghi lại kết quả cuối (ví dụ vào supervision.json) để dashboard đọc mà không tự gọi runtime.</>,
        <><b>Giám sát</b>: supervision.json (heartbeat, notices đã báo), messages/ (outbox).</>,
        <><b>Task đã kết thúc</b>: data/task-history.jsonl (có từ #25/#31) — mã, dự án, outcome, mốc round/report/decision; không có tiêu đề hay nội dung.</>,
        <><b>Token</b>: chưa có nguồn — chờ T-43 / #28.</>
      ]} />
      <H>Ngoài phạm vi v1</H>
      <UL items={['Mọi thao tác ghi (accept, trả lời, dispatch) — dashboard chỉ copy prompt.', 'Truy cập từ máy khác (chỉ bind 127.0.0.1).', 'Xem lại report hay quyết định của task đã kết thúc (Foreman không giữ nội dung).']} />
    </div>
  );
}
