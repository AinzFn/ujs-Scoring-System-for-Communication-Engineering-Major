# Cloudflare 与域名交接说明

本文档供后续 Codex 对话或维护人员继续操作 Cloudflare 和当前域名。不要在本文档或 GitHub 仓库中保存密码、Cookie、OAuth Token、API Token、学生名单、评分数据或 D1 导出文件。

## 当前资源

| 资源 | 当前值 |
| --- | --- |
| Cloudflare 账户 ID | `6b751f8885423e6d9565bc52d26144ef` |
| Worker 名称 | `class-score-app` |
| Worker 开发地址 | `https://class-score-app.class-score-app.workers.dev` |
| D1 数据库名称 | `class-score-db` |
| D1 数据库 ID | `fa319cb4-4fc9-49a4-befb-17709e960d20` |
| 当前自定义域名 | `ujscommunicationsengineering.asia` |
| Cloudflare Nameserver | `jessica.ns.cloudflare.com`、`walt.ns.cloudflare.com` |
| 域名注册商 | 腾讯云 |

当前域名根路径绑定到 `class-score-app` Worker。管理后台为 `/admin`，总管理员入口为 `/admin?super=1`。管理员密码不在源码中，密码哈希保存在 D1。

## 本地项目

要求 Node.js 20 或更高版本。首次拉取后运行：

```powershell
npm install
npx wrangler login
npx wrangler whoami
```

`wrangler whoami` 应显示上述账户 ID。不要把 Wrangler 本地认证目录提交到 GitHub。

## 部署当前项目

`wrangler.jsonc` 已配置 Worker、静态资源和 D1 绑定。发布命令：

```powershell
npm test
npx wrangler deploy
```

发布后检查：

```powershell
Invoke-WebRequest https://ujscommunicationsengineering.asia/api/health -UseBasicParsing
```

预期响应为 HTTP 200，并包含 `{"ok":true,"database":"connected"}`。

## 将当前域名改给其他项目

不要直接删除 D1 数据库或当前 Worker。推荐顺序：

1. 先部署新项目，确认其 `workers.dev` 地址可以正常访问。
2. 在 Cloudflare 控制台打开 `Workers & Pages`。
3. 进入 `class-score-app` → `Settings` 或 `Domains & Routes`。
4. 从当前 Worker 删除自定义域名 `ujscommunicationsengineering.asia`。这里只解除域名绑定，不删除 Worker 或 D1。
5. 进入新 Worker → `Domains & Routes` → `Add Domain`。
6. 选择 `ujscommunicationsengineering.asia`，根域名的 Subdomain 留空并确认。
7. 验证新项目的根路径、管理路径和 API。

域名已经使用 Cloudflare Nameserver，一般不需要再去腾讯云修改 DNS。只有把域名迁出 Cloudflare 时才需要修改 Nameserver。

## 新项目继续使用现有 D1

仅当新项目明确需要当前评分数据时才复用 D1。在新项目的 `wrangler.jsonc` 中配置：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "class-score-db",
      "database_id": "fa319cb4-4fc9-49a4-befb-17709e960d20"
    }
  ]
}
```

新项目若与评分系统无关，建议创建新的 D1/KV/R2 资源，不要复用或清空 `class-score-db`。

## 数据备份与恢复

远程 D1 导出会包含姓名和评分，不得上传 GitHub：

```powershell
npx wrangler d1 export class-score-db --remote --output backup-YYYYMMDD-HHMMSS.sql
```

Cloudflare D1 支持 Time Travel。任何整库恢复都会覆盖恢复时间点之后的全部变化，执行前必须先导出当前数据库并确认影响范围。

```powershell
npx wrangler d1 time-travel info class-score-db --timestamp 2026-10-05T00:00:00Z --json
npx wrangler d1 time-travel restore class-score-db --bookmark <bookmark>
```

## 安全边界

- 不要把总管理员密码写入 GitHub；需要重置时重新生成 PBKDF2 哈希并更新 D1。
- 不要提交 `.wrangler/`、`.env`、`data/`、`backup-*.sql` 或任何数据库导出。
- GitHub 仓库应保持私有，因为源码包含基础设施标识符，且该系统处理实名评分。
- 删除班级、管理员或执行 Time Travel 前先备份数据库。
- 切换域名只需修改 Custom Domain 绑定，不应删除腾讯云域名或更改 Nameserver。

## 当前源码结构

- `worker/index.js`：Cloudflare Worker API、权限与导出逻辑
- `public/`：学生端和管理端静态页面
- `migrations/`：D1 数据库结构迁移
- `tests/`：自动化测试
- `wrangler.jsonc`：Worker、Assets 与 D1 配置
- `使用说明.md`：面向最终用户的操作说明

