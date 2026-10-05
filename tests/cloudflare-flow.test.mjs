import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.CLOUDFLARE_TEST_URL;

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

test("Cloudflare Worker and D1 complete flow", { skip: !baseUrl }, async () => {
  let result = await api("/api/health");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.database, "connected");

  result = await api("/api/state");
  assert.equal(result.data.configured, false, "Cloudflare integration test requires a fresh local D1 database");

  result = await api("/api/setup", {
    method: "POST",
    body: { password: "cloud-test-pass", roster: ["甲同学", "乙同学", "丙同学"] }
  });
  assert.equal(result.response.status, 201);
  const setupAdminCookie = cookieFrom(result.response);

  result = await api("/api/student/login", { method: "POST", body: { name: "甲同学" } });
  assert.equal(result.response.status, 200);
  const studentCookie = cookieFrom(result.response);

  result = await api("/api/student/submit", {
    method: "POST",
    cookie: studentCookie,
    body: { scores: { 甲同学: 16, 乙同学: 17, 丙同学: 18 } }
  });
  assert.equal(result.response.status, 201);

  result = await api("/api/student/scores", { cookie: studentCookie });
  assert.equal(result.data.submitted, true);
  assert.equal(Object.hasOwn(result.data, "scores"), false);

  result = await api("/api/admin/dashboard", { cookie: setupAdminCookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.submissions.map((item) => item.submitted), [true, false, false]);
  assert.equal(Object.hasOwn(result.data.submissions[0], "scores"), false);

  result = await api("/api/admin/export?type=raw", { cookie: setupAdminCookie });
  assert.equal(result.response.status, 200);
  assert.match(result.data, /"甲同学".*"16","17","18"/);

  result = await api("/api/admin/export?type=summary", { cookie: setupAdminCookie });
  assert.equal(result.response.status, 200);
  assert.match(result.data, /"乙同学","1","17","17\.00"/);

  result = await api("/api/admin/reset-submission", {
    method: "POST",
    cookie: setupAdminCookie,
    body: { name: "甲同学" }
  });
  assert.equal(result.response.status, 200);

  result = await api("/api/student/scores", { cookie: studentCookie });
  assert.equal(result.data.submitted, false);
});
