import http from "node:http";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = join(rootDirectory, "public");
const dataFile = resolve(process.env.DATA_FILE || join(rootDirectory, "data", "score-data.json"));
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const maxBodyBytes = 1024 * 1024;
const adminAttempts = new Map();

let store = await loadStore();
let writeQueue = Promise.resolve();
let setupInProgress = false;

function emptyStore() {
  return {
    version: 1,
    configured: false,
    secret: null,
    passwordSalt: null,
    passwordHash: null,
    roster: [],
    submissions: {},
    createdAt: null,
    updatedAt: null
  };
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, "utf8"));
    return { ...emptyStore(), ...parsed };
  } catch (error) {
    if (error.code === "ENOENT") return emptyStore();
    throw new Error(`Unable to read score data: ${error.message}`);
  }
}

async function persistStore() {
  store.updatedAt = new Date().toISOString();
  const snapshot = `${JSON.stringify(store, null, 2)}\n`;
  const tempFile = `${dataFile}.tmp`;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(resolve(dataFile, ".."), { recursive: true });
    await writeFile(tempFile, snapshot, { encoding: "utf8", mode: 0o600 });
    await rename(tempFile, dataFile);
  });
  return writeQueue;
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function validateRoster(value) {
  if (!Array.isArray(value)) return { error: "名单格式不正确" };
  const roster = value.map(normalizeName).filter(Boolean);
  if (roster.length < 1) return { error: "名单至少需要 1 人" };
  if (roster.length > 300) return { error: "当前版本最多支持 300 人" };
  if (roster.some((name) => name.length > 50)) return { error: "姓名不能超过 50 个字符" };
  const unique = [...new Set(roster)];
  if (unique.length !== roster.length) return { error: "名单中存在重复姓名，请先处理重名" };
  return { roster };
}

async function hashPassword(password, saltHex) {
  const hash = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  return Buffer.from(hash).toString("hex");
}

async function passwordMatches(password) {
  if (!store.passwordSalt || !store.passwordHash) return false;
  const candidate = Buffer.from(await hashPassword(password, store.passwordSalt), "hex");
  const expected = Buffer.from(store.passwordHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", store.secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSession(request, expectedRole) {
  if (!store.secret) return null;
  const cookies = Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((item) => item.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([key, value]) => key && value)
  );
  const token = cookies[`${expectedRole}_session`];
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", store.secret).update(encoded).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.role !== expectedRole || payload.exp < Date.now()) return null;
    if (expectedRole === "student" && !store.roster.includes(payload.name)) return null;
    return payload;
  } catch {
    return null;
  }
}

function isHttps(request) {
  return request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
}

function setSession(response, request, payload, maxAgeSeconds) {
  const secure = isHttps(request) ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${payload.role}_session=${signSession(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
  );
}

function clearSession(response, request, role) {
  const secure = isHttps(request) ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${role}_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("请求内容过大");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求内容格式不正确");
    error.status = 400;
    throw error;
  }
}

function clientAddress(request) {
  return String(request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "unknown");
}

function loginAllowed(request) {
  const key = clientAddress(request);
  const now = Date.now();
  const recent = (adminAttempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 10) return false;
  recent.push(now);
  adminAttempts.set(key, recent);
  return true;
}

function requireConfigured(response) {
  if (store.configured) return true;
  sendError(response, 409, "管理员尚未完成初始化设置");
  return false;
}

function requireAdmin(request, response) {
  const session = readSession(request, "admin");
  if (session) return session;
  sendError(response, 401, "请先登录管理员页面");
  return null;
}

function requireStudent(request, response) {
  const session = readSession(request, "student");
  if (session) return session;
  sendError(response, 401, "请先填写本人姓名");
  return null;
}

function validateScores(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "评分格式不正确" };
  const keys = Object.keys(value);
  if (keys.length !== store.roster.length || keys.some((name) => !store.roster.includes(name))) {
    return { error: "必须为名单中的每位同学评分" };
  }
  const scores = {};
  for (const name of store.roster) {
    const score = Number(value[name]);
    if (!Number.isInteger(score) || score < 10 || score > 20) {
      return { error: `${name} 的评分必须是 10–20 之间的整数` };
    }
    scores[name] = score;
  }
  return { scores };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function makeRawCsv() {
  const header = ["评分人", "提交时间", ...store.roster];
  const rows = [header];
  for (const rater of store.roster) {
    const submission = store.submissions[rater];
    if (!submission) continue;
    rows.push([rater, submission.submittedAt, ...store.roster.map((target) => submission.scores[target])]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function makeSummaryCsv() {
  const rows = [["姓名", "评分人数", "总分", "平均分", "最高分", "最低分", "自评分", "去除自评平均分"]];
  for (const target of store.roster) {
    const values = [];
    const valuesWithoutSelf = [];
    let selfScore = "";
    for (const [rater, submission] of Object.entries(store.submissions)) {
      const score = submission.scores[target];
      values.push(score);
      if (rater === target) selfScore = score;
      else valuesWithoutSelf.push(score);
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length ? (total / values.length).toFixed(2) : "";
    const averageWithoutSelf = valuesWithoutSelf.length
      ? (valuesWithoutSelf.reduce((sum, value) => sum + value, 0) / valuesWithoutSelf.length).toFixed(2)
      : "";
    rows.push([
      target,
      values.length,
      values.length ? total : "",
      average,
      values.length ? Math.max(...values) : "",
      values.length ? Math.min(...values) : "",
      selfScore,
      averageWithoutSelf
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function sendCsv(response, csv, filename) {
  const encodedFilename = encodeURIComponent(filename);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="scores.csv"; filename*=UTF-8''${encodedFilename}`
  });
  response.end(`\uFEFF${csv}`);
}

async function serveStatic(pathname, response) {
  const files = {
    "/": "index.html",
    "/admin": "admin.html",
    "/styles.css": "styles.css",
    "/student.js": "student.js",
    "/admin.js": "admin.js"
  };
  const filename = files[pathname];
  if (!filename) return false;
  const content = await readFile(join(publicDirectory, filename));
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[extname(filename)];
  response.writeHead(200, { "Content-Type": type });
  response.end(content);
  return true;
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, {
      configured: store.configured,
      roster: store.configured ? store.roster : [],
      submittedCount: Object.keys(store.submissions).length,
      totalCount: store.roster.length
    });
  }

  if (request.method === "POST" && pathname === "/api/setup") {
    if (store.configured || setupInProgress) return sendError(response, 409, "系统已经完成或正在进行初始化");
    setupInProgress = true;
    try {
      const body = await readJson(request);
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 100) {
        return sendError(response, 400, "管理员密码需要 8–100 个字符");
      }
      const checked = validateRoster(body.roster);
      if (checked.error) return sendError(response, 400, checked.error);
      const salt = randomBytes(16).toString("hex");
      store = {
        ...emptyStore(),
        configured: true,
        secret: randomBytes(32).toString("hex"),
        passwordSalt: salt,
        passwordHash: await hashPassword(password, salt),
        roster: checked.roster,
        createdAt: new Date().toISOString()
      };
      await persistStore();
      setSession(response, request, { role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }, 12 * 60 * 60);
      return sendJson(response, 201, { ok: true });
    } finally {
      setupInProgress = false;
    }
  }

  if (request.method === "POST" && pathname === "/api/student/login") {
    if (!requireConfigured(response)) return;
    const body = await readJson(request);
    const name = normalizeName(body.name);
    if (!store.roster.includes(name)) return sendError(response, 400, "姓名不在名单中，请检查输入");
    setSession(
      response,
      request,
      { role: "student", name, exp: Date.now() + 3 * 24 * 60 * 60 * 1000 },
      3 * 24 * 60 * 60
    );
    return sendJson(response, 200, { ok: true, name });
  }

  if (request.method === "GET" && pathname === "/api/student/scores") {
    if (!requireConfigured(response)) return;
    const session = requireStudent(request, response);
    if (!session) return;
    return sendJson(response, 200, {
      name: session.name,
      roster: store.roster,
      submitted: Boolean(store.submissions[session.name]),
      submittedAt: store.submissions[session.name]?.submittedAt || null
    });
  }

  if (request.method === "POST" && pathname === "/api/student/submit") {
    if (!requireConfigured(response)) return;
    const session = requireStudent(request, response);
    if (!session) return;
    if (store.submissions[session.name]) return sendError(response, 409, "你已经提交过评分，不能重复提交");
    const body = await readJson(request);
    const checked = validateScores(body.scores);
    if (checked.error) return sendError(response, 400, checked.error);
    store.submissions[session.name] = {
      submittedAt: new Date().toISOString(),
      scores: checked.scores
    };
    await persistStore();
    return sendJson(response, 201, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/student/logout") {
    clearSession(response, request, "student");
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/admin/logout") {
    clearSession(response, request, "admin");
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/admin/login") {
    if (!requireConfigured(response)) return;
    if (!loginAllowed(request)) return sendError(response, 429, "登录尝试过多，请 10 分钟后重试");
    const body = await readJson(request);
    if (!(await passwordMatches(String(body.password || "")))) return sendError(response, 401, "管理员密码错误");
    setSession(response, request, { role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }, 12 * 60 * 60);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/admin/dashboard") {
    if (!requireConfigured(response)) return;
    if (!requireAdmin(request, response)) return;
    return sendJson(response, 200, {
      roster: store.roster,
      submissions: store.roster.map((name) => ({
        name,
        submitted: Boolean(store.submissions[name]),
        submittedAt: store.submissions[name]?.submittedAt || null
      }))
    });
  }

  if (request.method === "POST" && pathname === "/api/admin/roster") {
    if (!requireAdmin(request, response)) return;
    const body = await readJson(request);
    const checked = validateRoster(body.roster);
    if (checked.error) return sendError(response, 400, checked.error);
    const hasSubmissions = Object.keys(store.submissions).length > 0;
    if (hasSubmissions && body.confirmReset !== true) {
      return sendError(response, 409, "更换名单会清空现有评分，请先确认");
    }
    store.roster = checked.roster;
    store.submissions = {};
    await persistStore();
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/admin/reset-submission") {
    if (!requireAdmin(request, response)) return;
    const body = await readJson(request);
    const name = normalizeName(body.name);
    if (!store.roster.includes(name)) return sendError(response, 400, "姓名不在名单中");
    delete store.submissions[name];
    await persistStore();
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/admin/export") {
    if (!requireAdmin(request, response)) return;
    const date = new Date().toISOString().slice(0, 10);
    if (url.searchParams.get("type") === "summary") {
      return sendCsv(response, makeSummaryCsv(), `评分汇总-${date}.csv`);
    }
    return sendCsv(response, makeRawCsv(), `评分明细-${date}.csv`);
  }

  return sendError(response, 404, "未找到请求的功能");
}

const server = http.createServer(async (request, response) => {
  securityHeaders(response);
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (request.method === "GET" && (await serveStatic(url.pathname, response))) return;
    sendError(response, 404, "页面不存在");
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendError(response, error.status || 500, error.status ? error.message : "服务器出现错误");
    else response.end();
  }
});

server.listen(port, host, () => {
  const shownHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Class scoring app: http://${shownHost}:${port}`);
  console.log(`Admin page:       http://${shownHost}:${port}/admin`);
  console.log(`Data file:        ${dataFile}`);
});

export { server };
