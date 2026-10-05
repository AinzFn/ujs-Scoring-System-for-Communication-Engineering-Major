const views = ["loading-view", "pending-view", "login-view", "score-view", "done-view"];
let roster = [];
let currentStudent = null;
let classes = [];
const nameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function showView(id) {
  for (const viewId of views) document.getElementById(viewId).classList.toggle("hidden", viewId !== id);
}

function setError(id, message = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function setBusy(form, busy) {
  for (const control of form.elements) control.disabled = busy;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function fillNameOptions() {
  const options = document.getElementById("roster-options");
  options.replaceChildren();
  for (const name of roster) {
    const option = document.createElement("option");
    option.value = name;
    options.append(option);
  }
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function renderScoreForm(student) {
  roster = student.roster;
  currentStudent = student.name;
  document.getElementById("rater-name").textContent = student.name;
  document.getElementById("total-count").textContent = String(student.roster.length);
  const list = document.getElementById("score-list");
  list.replaceChildren();

  for (const target of student.roster) {
    const row = document.createElement("div");
    row.className = "score-row";

    const person = document.createElement("div");
    person.className = "score-person";
    const name = document.createElement("span");
    name.textContent = target;
    person.append(name);
    if (target === student.name) {
      const badge = document.createElement("span");
      badge.className = "self-badge";
      badge.textContent = "本人";
      person.append(badge);
    }

    const select = document.createElement("select");
    select.name = target;
    select.setAttribute("aria-label", `给${target}评分`);
    select.required = true;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择";
    select.append(placeholder);
    for (let score = 10; score <= 20; score += 1) {
      const option = document.createElement("option");
      option.value = String(score);
      option.textContent = `${score} 分`;
      select.append(option);
    }
    select.addEventListener("change", () => {
      row.classList.toggle("complete", Boolean(select.value));
      updateProgress();
    });
    row.append(person, select);
    list.append(row);
  }
  updateProgress();
  showView("score-view");
}

function updateProgress() {
  const selects = [...document.querySelectorAll("#score-list select")];
  const completed = selects.filter((select) => select.value).length;
  document.getElementById("completed-count").textContent = String(completed);
  document.getElementById("submit-scores").disabled = completed !== selects.length;
}

async function loadStudentState() {
  const { response, data } = await request("/api/student/scores");
  if (response.ok) {
    if (data.submitted) {
      currentStudent = data.name;
      document.getElementById("done-message").textContent = `${data.name}，提交时间：${formatTime(data.submittedAt)}`;
      showView("done-view");
    } else {
      renderScoreForm(data);
    }
    return;
  }
  showView("login-view");
}

async function logout() {
  await request("/api/student/logout", { method: "POST" });
  currentStudent = null;
  document.getElementById("login-form").reset();
  setError("login-error");
  showView("login-view");
  document.getElementById("student-name").focus();
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = document.getElementById("student-name").value.trim();
  setError("login-error");
  if (!name) return setError("login-error", "请输入本人姓名");
  setBusy(form, true);
  try {
    const { response, data } = await request("/api/student/login", {
      method: "POST",
      body: JSON.stringify({ name, classId: Number(document.getElementById("student-class").value) })
    });
    if (!response.ok) return setError("login-error", data.error || "无法进入评分");
    await loadStudentState();
  } catch {
    setError("login-error", "无法连接服务器，请稍后重试");
  } finally {
    setBusy(form, false);
  }
});

document.getElementById("score-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const scores = Object.fromEntries([...document.querySelectorAll("#score-list select")].map((select) => [select.name, Number(select.value)]));
  setError("score-error");
  if (Object.keys(scores).length !== roster.length || Object.values(scores).some((score) => !Number.isInteger(score))) {
    return setError("score-error", "请完成名单中所有人的评分");
  }
  if (!window.confirm(`确认以“${currentStudent}”的姓名提交 ${roster.length} 项评分吗？提交后不能修改。`)) return;
  setBusy(form, true);
  try {
    const { response, data } = await request("/api/student/submit", {
      method: "POST",
      body: JSON.stringify({ scores })
    });
    if (!response.ok) return setError("score-error", data.error || "提交失败，请重试");
    await loadStudentState();
  } catch {
    setError("score-error", "无法连接服务器，请检查网络后重试");
  } finally {
    setBusy(form, false);
    updateProgress();
  }
});

document.getElementById("switch-user").addEventListener("click", logout);
document.getElementById("done-switch-user").addEventListener("click", logout);

async function initialize() {
  try {
    const { response, data } = await request("/api/state");
    if (!response.ok || !data.configured) return showView("pending-view");
    classes = (data.classes || []).sort((a, b) => nameCollator.compare(a.name, b.name));
    const classSelect = document.getElementById("student-class");
    classSelect.replaceChildren();
    for (const item of classes) { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; classSelect.append(option); }
    classSelect.size = Math.min(Math.max(classes.length, 1), 6);
    if (!classes.length) return showView("pending-view");
    fillNameOptions();
    await loadStudentState();
  } catch {
    document.querySelector("#pending-view h1").textContent = "暂时无法连接";
    document.querySelector("#pending-view p").textContent = "请检查网络后刷新页面。";
    showView("pending-view");
  }
}

initialize();
