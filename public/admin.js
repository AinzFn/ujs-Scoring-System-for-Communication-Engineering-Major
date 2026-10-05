const views = ["admin-loading", "setup-view", "admin-login-view", "super-login-view", "dashboard-view"];
function show(id) {
  const combined = id === "combined";
  views.forEach(x => document.getElementById(x).classList.toggle("hidden", combined ? !["admin-login-view", "setup-view"].includes(x) : x !== id));
}
function err(id, message = "") { const e = document.getElementById(id); e.textContent = message; e.classList.toggle("hidden", !message); }
function parseRoster(text) { return String(text).split(/[\n\r,，、;；\t]+/).map(x => x.trim().replace(/\s+/g, " ")).filter(Boolean); }
async function request(path, options = {}) { const r = await fetch(path, { ...options, headers: options.body ? { "Content-Type": "application/json" } : undefined }); const d = await r.json().catch(() => ({})); return { r, d }; }
function count(textarea, target) { document.getElementById(target).textContent = `当前识别 ${parseRoster(document.getElementById(textarea).value).length} 人`; }
function time(v) { return v ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—"; }
const nameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
function render(data) {
  const all = data.role === "super";
  document.getElementById("dashboard-role").textContent = all ? "总管理员后台" : "班级管理员后台";
  const rows = data.classes.flatMap(c => c.submissions.map(x => ({ ...x, classId: c.id, className: c.name })));
  const submitted = rows.filter(x => x.submitted).length;
  const total = data.classes.reduce((n, c) => n + c.roster.length, 0);
  document.getElementById("submitted-metric").textContent = String(submitted);
  document.getElementById("pending-metric").textContent = String(total - submitted);
  document.getElementById("rate-metric").textContent = `${total ? Math.round(submitted / total * 100) : 0}%`;
  data.classes.sort((a, b) => nameCollator.compare(a.name, b.name));
  const first = data.classes[0];
  window.currentAdminClassId = first?.id || null;
  document.getElementById("export-all").classList.toggle("hidden", !all);
  document.getElementById("export-raw").classList.toggle("hidden", all || !first);
  document.getElementById("export-rater").classList.toggle("hidden", !all);
  document.getElementById("rater-export-tools").classList.toggle("hidden", !all);
  if (all) {
    const select = document.getElementById("export-class"); select.replaceChildren();
    data.classes.forEach(c => { const o=document.createElement("option"); o.value=c.id; o.textContent=c.name; select.append(o); });
    const updateRaterLink = () => { const c=select.value, n=encodeURIComponent(document.getElementById("export-rater-name").value.trim()); document.getElementById("export-rater-link").href=`/api/super/export-rater?classId=${c}&raters=${n}`; };
    select.onchange=updateRaterLink; document.getElementById("export-rater-name").oninput=updateRaterLink; updateRaterLink();
  }
  if (first && !all) document.getElementById("export-raw").href = `/api/admin/export?classId=${first.id}`;
  document.getElementById("roster-settings").classList.toggle("hidden", all);
  const filter = document.getElementById("admin-class-filter"); filter.replaceChildren(); const allOption=document.createElement("option"); allOption.value="all"; allOption.textContent="全部班级"; filter.append(allOption); for(const c of data.classes){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;filter.append(o);} filter.classList.toggle("hidden", !all);
  const deleteTools = document.getElementById("class-delete-tools"); deleteTools.replaceChildren(); deleteTools.classList.toggle("hidden", !all);
  if (all) for (const c of data.classes) { const wrap=document.createElement("div"); const b=document.createElement("button"); b.className="button danger small"; b.textContent=`删除班级：${c.name}`; b.onclick=()=>removeClass(c.id,c.name); wrap.append(b); if(c.adminId){ const a=document.createElement("button"); a.className="button danger small"; a.textContent=`删除管理员：${c.adminName}`; a.onclick=()=>removeAdmin(c.adminId,c.adminName,c.name); wrap.append(a); } deleteTools.append(wrap); }
  const list = document.getElementById("submission-list"); list.replaceChildren(); const renderClasses = () => { list.replaceChildren(); const selected=filter.value; for(const c of data.classes) { if(selected!=="all" && String(c.id)!==selected) continue; const details=document.createElement("details"); details.className="class-status-panel"; details.open=selected!=="all" ? true : false; const summary=document.createElement("summary"); summary.textContent=`${c.name}（${c.submissions.filter(x=>x.submitted).length}/${c.roster.length} 人已提交）`; details.append(summary); const wrap=document.createElement("div"); wrap.className="status-table-wrap"; const table=document.createElement("table"); table.className="status-table"; table.innerHTML="<thead><tr><th>姓名</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>"; const tbody=document.createElement("tbody"); for(const item of c.submissions){const tr=document.createElement("tr"); [item.name,item.submitted?"已提交":"待提交",time(item.submittedAt)].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);}); const action=document.createElement("td"); if(item.submitted&&!all){const b=document.createElement("button");b.className="button quiet small";b.textContent="允许重填";b.onclick=()=>reset(c.id,item.name);action.append(b);}tr.append(action);tbody.append(tr);} table.append(tbody); wrap.append(table); details.append(wrap); list.append(details); } }; filter.onchange=renderClasses; renderClasses();
  show("dashboard-view");
}
async function dashboard() { const {r,d}=await request("/api/admin/dashboard"); if(r.ok) render(d); else show(new URLSearchParams(location.search).has("super") ? "super-login-view" : "combined"); }
async function reset(classId, name) { if(!confirm(`确认允许 ${name} 重新填写吗？`))return; await request("/api/admin/reset-submission",{method:"POST",body:JSON.stringify({classId,name})}); dashboard(); }
async function removeClass(classId, name) { if(!confirm(`确认删除班级“${name}”吗？该班级的名单和所有评分会永久删除，但管理员名下的其他班级不会受影响。`))return; const {r,d}=await request("/api/super/class",{method:"DELETE",body:JSON.stringify({classId})}); if(!r.ok)return alert(d.error||"删除失败"); dashboard(); }
async function removeAdmin(adminId, adminName, className) { if(!confirm(`确认删除管理员“${adminName}”吗？其管理的班级“${className}”、名单和所有评分也会永久删除。`))return; const {r,d}=await request("/api/super/admin",{method:"DELETE",body:JSON.stringify({adminId})}); if(!r.ok)return alert(d.error||"删除失败"); dashboard(); }
document.getElementById("setup-roster").oninput=()=>count("setup-roster","setup-count"); document.getElementById("roster-editor").oninput=()=>count("roster-editor","roster-editor-count");
document.getElementById("setup-form").onsubmit=async e=>{e.preventDefault();const b={name:document.getElementById("admin-name").value,className:document.getElementById("class-name").value,roster:parseRoster(document.getElementById("setup-roster").value),password:document.getElementById("setup-password").value};if(b.password!==document.getElementById("setup-password-confirm").value)return err("setup-error","两次密码不一致");const {r,d}=await request("/api/admin/register",{method:"POST",body:JSON.stringify(b)});if(!r.ok)return err("setup-error",d.error||"创建失败");dashboard();};
document.getElementById("admin-login-form").onsubmit=async e=>{e.preventDefault();const {r,d}=await request("/api/admin/login",{method:"POST",body:JSON.stringify({name:document.getElementById("login-admin-name").value,password:document.getElementById("admin-password").value})});if(!r.ok)return err("admin-login-error",d.error||"登录失败");dashboard();};
document.getElementById("super-login-form").onsubmit=async e=>{e.preventDefault();const {r,d}=await request("/api/super/login",{method:"POST",body:JSON.stringify({password:document.getElementById("super-password").value})});if(!r.ok)return err("super-login-error",d.error||"登录失败");dashboard();};
document.getElementById("admin-logout").onclick=async()=>{await request("/api/admin/logout",{method:"POST"});location.reload();};
document.getElementById("roster-form").onsubmit=async e=>{e.preventDefault();const first=window.currentAdminClassId;if(!first)return err("roster-error","请选择要修改的班级");const {r,d}=await request("/api/admin/roster",{method:"POST",body:JSON.stringify({classId:first,roster:parseRoster(document.getElementById("roster-editor").value),confirmReset:true})});if(!r.ok)return err("roster-error",d.error||"操作失败");dashboard();};
init();
async function init(){const {r,d}=await request("/api/state");if(!r.ok)return;const q=new URLSearchParams(location.search);if(q.has("super"))return show("super-login-view");if(!d.configured)return show("setup-view");show("combined");}
