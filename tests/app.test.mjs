import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const appDirectory = resolve(import.meta.dirname, "..");
let serverProcess;
let temporaryDirectory;
let baseUrl;

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error("Test server did not start");
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test.before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "class-score-test-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_FILE: join(temporaryDirectory, "scores.json")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("complete scoring flow protects results and supports exports", async () => {
  let result = await api("/api/state");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.configured, false);

  result = await api("/api/setup", {
    method: "POST",
    body: { password: "strong-pass-123", roster: ["张三", "李四"] }
  });
  assert.equal(result.response.status, 201);
  const setupAdminCookie = cookieFrom(result.response);
  assert.match(setupAdminCookie, /^admin_session=/);

  result = await api("/api/student/login", { method: "POST", body: { name: "不存在" } });
  assert.equal(result.response.status, 400);

  result = await api("/api/student/login", { method: "POST", body: { name: "张三" } });
  assert.equal(result.response.status, 200);
  const studentCookie = cookieFrom(result.response);
  assert.match(studentCookie, /^student_session=/);

  result = await api("/api/student/submit", {
    method: "POST",
    cookie: studentCookie,
    body: { scores: { 张三: 10 } }
  });
  assert.equal(result.response.status, 400);

  result = await api("/api/student/submit", {
    method: "POST",
    cookie: studentCookie,
    body: { scores: { 张三: 10, 李四: 21 } }
  });
  assert.equal(result.response.status, 400);

  result = await api("/api/student/submit", {
    method: "POST",
    cookie: studentCookie,
    body: { scores: { 张三: 10, 李四: 20 } }
  });
  assert.equal(result.response.status, 201);

  result = await api("/api/student/submit", {
    method: "POST",
    cookie: studentCookie,
    body: { scores: { 张三: 11, 李四: 19 } }
  });
  assert.equal(result.response.status, 409);

  result = await api("/api/student/scores", { cookie: studentCookie });
  assert.equal(result.data.submitted, true);
  assert.equal(Object.hasOwn(result.data, "scores"), false);

  result = await api("/api/admin/login", { method: "POST", body: { password: "wrong-pass" } });
  assert.equal(result.response.status, 401);

  result = await api("/api/admin/login", { method: "POST", body: { password: "strong-pass-123" } });
  assert.equal(result.response.status, 200);
  const adminCookie = cookieFrom(result.response);

  result = await api("/api/admin/dashboard", { cookie: adminCookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.submissions.map((item) => item.submitted), [true, false]);
  assert.equal(Object.hasOwn(result.data.submissions[0], "scores"), false);

  result = await api("/api/admin/export?type=raw", { cookie: adminCookie });
  assert.equal(result.response.status, 200);
  assert.match(result.data, /"评分人","提交时间","张三","李四"/);
  assert.match(result.data, /"张三".*"10","20"/);

  result = await api("/api/admin/export?type=summary", { cookie: setupAdminCookie });
  assert.equal(result.response.status, 200);
  assert.match(result.data, /"姓名","评分人数","总分","平均分"/);
  assert.match(result.data, /"李四","1","20","20\.00"/);

  result = await api("/api/admin/reset-submission", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "张三" }
  });
  assert.equal(result.response.status, 200);

  result = await api("/api/student/scores", { cookie: studentCookie });
  assert.equal(result.data.submitted, false);
});

test("rejects duplicate roster names", async () => {
  const result = await api("/api/admin/roster", {
    method: "POST",
    cookie: (await api("/api/admin/login", {
      method: "POST",
      body: { password: "strong-pass-123" }
    })).response.headers.get("set-cookie").split(";", 1)[0],
    body: { roster: ["张三", "张三"], confirmReset: true }
  });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /重复姓名/);
});
