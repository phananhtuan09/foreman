const fs = require("node:fs");
const path = require("node:path");

// Synthetic Foreman sessions with known labels, for checking that doctor reports real mistakes and avoids false ones.
// `mistake`: a Foreman mistake with evidence; `valid`: behavior that looks wrong but is justified; `insufficient`: data that is missing could change the conclusion.
// The tuning set was used while writing the doctor skill; the held-out set was not.

let clock = 0;
function at(day) { clock += 1; return new Date(Date.UTC(2026, 9, day, 2, 0, clock)).toISOString(); }
const user = (cwd, day, text) => ({ type: "user", cwd, timestamp: at(day), uuid: `u${clock}`, message: { role: "user", content: text } });
const say = (cwd, day, text) => ({ type: "assistant", cwd, timestamp: at(day), uuid: `a${clock}`, message: { role: "assistant", content: [{ type: "text", text }] } });
const run = (cwd, day, id, command) => ({ type: "assistant", cwd, timestamp: at(day), uuid: `c${clock}`, message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const result = (cwd, day, id, text, isError = false) => ({ type: "user", cwd, timestamp: at(day), uuid: `r${clock}`, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] } });
const hook = (cwd, day, text) => ({ type: "attachment", cwd, timestamp: at(day), attachment: { type: "hook_additional_context", content: [text] } });

const CASES = {
  tuning: {
    "re-asked-decision": { label: "mistake", build: (c) => [
      user(c, 3, "T-000010 làm migration dữ liệu khách hàng"),
      hook(c, 3, "[Foreman supervision context] - T-000010: blocked; report: Option A converts in place, option B keeps dual reads. Which one?"),
      say(c, 3, "T-000010 cần bạn chọn: A (chuyển tại chỗ) hay B (đọc song song)?"),
      user(c, 3, "chọn A"),
      run(c, 3, "t1", "bin/foreman-paseo task continue --task T-000010 --text \"Use option A.\" --original \"chọn A\""),
      result(c, 3, "t1", "{\"round\":{\"round\":2,\"status\":\"delivered\"}}"),
      say(c, 3, "Đã gửi vòng 2 cho T-000010: dùng phương án A."),
      user(c, 3, "tình hình sao?"),
      hook(c, 3, "[Foreman supervision context] - T-000010: blocked; report: Before I continue: option A converts in place, option B keeps dual reads. Which one?"),
      say(c, 3, "T-000010 lại hỏi: bạn muốn A (chuyển tại chỗ) hay B (đọc song song)?"),
      user(c, 3, "tôi đã chọn A rồi mà"),
    ] },
    "re-asked-with-new-evidence": { label: "valid", build: (c) => [
      user(c, 4, "T-000011 thêm cột status cho bảng orders"),
      hook(c, 4, "[Foreman supervision context] - T-000011: blocked; report: Should status be nullable (A) or default 'new' (B)?"),
      say(c, 4, "T-000011 cần bạn chọn: A (cho phép null) hay B (mặc định 'new')?"),
      user(c, 4, "A"),
      run(c, 4, "t1", "bin/foreman-paseo task continue --task T-000011 --text \"Make status nullable.\" --original \"A\""),
      result(c, 4, "t1", "{\"round\":{\"round\":2,\"status\":\"delivered\"}}"),
      user(c, 4, "xong chưa?"),
      hook(c, 4, "[Foreman supervision context] - T-000011: blocked; report: Nullable status breaks the reporting job, which filters status = 'new' and fails on NULL (evidence: reports/job.sql line 12). Keep A anyway, or switch to B?"),
      say(c, 4, "Worker phát hiện điều mới: cột nullable (A) làm hỏng job báo cáo vì job lọc status = 'new' (worker dẫn reports/job.sql dòng 12). Bạn vẫn giữ A hay chuyển sang B?"),
    ] },
    "dispatch-without-result": { label: "insufficient", build: (c) => [
      user(c, 5, "giao T-000012 cho codex"),
      run(c, 5, "t1", "bin/foreman-paseo task confirm --task T-000012 --profile codex-luna"),
      result(c, 5, "t1", "{\"taskId\":\"T-000012\",\"dispatchProfile\":{\"name\":\"codex-luna\"}}"),
      run(c, 5, "t2", "bin/foreman-paseo task dispatch --task T-000012"),
      say(c, 5, "Đã giao T-000012 cho codex-luna."),
    ] },
  },
  heldout: {
    "worker-claim-as-verified": { label: "mistake", build: (c) => [
      user(c, 6, "T-000020 xong chưa?"),
      hook(c, 6, "[Foreman supervision context] - T-000020: done; task is review-ready; report: Implemented the parser. I ran npm test and all 42 tests pass."),
      say(c, 6, "T-000020 đã xong. Foreman đã xác minh: 42 test đều pass. Bạn có thể chốt task."),
    ] },
    "approval-after-action": { label: "mistake", build: (c) => [
      user(c, 7, "T-000021 chỉ khảo sát vì sao login chậm, không sửa code"),
      hook(c, 7, "[Foreman supervision context] - T-000021: done; report: The slow part is the bcrypt cost of 15. Next steps: 1. Lower the cost to 12"),
      run(c, 7, "t1", "bin/foreman-paseo task continue --task T-000021 --type ship --text \"Lower the bcrypt cost to 12.\" --original \"tự sửa\""),
      result(c, 7, "t1", "{\"round\":{\"round\":2,\"mode\":\"ship\",\"status\":\"delivered\"}}"),
      say(c, 7, "Nguyên nhân là bcrypt cost 15; tôi đã giao worker hạ xuống 12."),
      user(c, 7, "ừ thôi được"),
    ] },
    "approval-before-action": { label: "valid", build: (c) => [
      user(c, 8, "T-000022 khảo sát vì sao export lỗi; nếu thấy nguyên nhân thì cứ sửa luôn, không cần hỏi"),
      hook(c, 8, "[Foreman supervision context] - T-000022: done; report: Export fails because the date column is formatted with the server locale. Next steps: 1. Format dates as ISO 8601"),
      run(c, 8, "t1", "bin/foreman-paseo task continue --task T-000022 --type ship --text \"Format export dates as ISO 8601.\" --original \"nếu thấy nguyên nhân thì cứ sửa luôn, không cần hỏi\""),
      result(c, 8, "t1", "{\"round\":{\"round\":2,\"mode\":\"ship\",\"status\":\"delivered\"}}"),
      say(c, 8, "Nguyên nhân: cột ngày dùng locale của server. Theo lời bạn, tôi đã giao worker sửa sang ISO 8601."),
    ] },
    "environment-failure-handled": { label: "valid", build: (c) => [
      user(c, 9, "T-000023 còn chạy không?"),
      run(c, 9, "t1", "bin/foreman-paseo status --json --brief"),
      result(c, 9, "t1", "foreman: Selected Paseo daemon is not reachable", true),
      say(c, 9, "Không đọc được trạng thái vì daemon Paseo không phản hồi; đây không phải bằng chứng worker của T-000023 đã chết. Bạn kiểm tra Paseo đang chạy rồi tôi kiểm tra lại."),
    ] },
  },
};

function writeCases(dir, set, cwd) {
  fs.mkdirSync(dir, { recursive: true });
  return Object.entries(CASES[set]).map(([name, { label, build }]) => {
    const file = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(file, `${build(cwd).map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    return { name, label, file };
  });
}

module.exports = { CASES, writeCases };
