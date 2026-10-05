# 班级互评系统

这是一个已经部署到 Cloudflare Workers + D1 的班级互评网页。Cloudflare 免费额度负责运行网页和保存数据，管理员与学生都不需要安装程序或保持电脑开机。

## 正式地址

- 学生端：https://ujscommunicationsengineering.asia/
- 管理端：https://ujscommunicationsengineering.asia/admin
- 总管理员：https://ujscommunicationsengineering.asia/admin?super=1

面向使用者的完整操作说明请参阅 [使用说明.md](使用说明.md)。

## 第一次使用

1. 打开管理端。
2. 设置至少 8 个字符的管理员密码。
3. 粘贴班级名单，名单支持换行、逗号、中文逗号或表格单列粘贴。
4. 检查名单后创建评分活动。
5. 把学生端地址发给同学。

每位同学输入名单中的本人姓名，为名单中的所有人（包括自己）填写 10–20 分整数。每个姓名只能提交一次；提交后再次用该班级和姓名登录会被拒绝，只有班级管理员点击“允许重填”后才可重新进入。学生端不会显示任何评分结果。

## 管理与导出

- 管理员可以查看每个人的提交状态。
- “导出评分明细”生成评分人 × 被评分人的完整矩阵。
- “导出汇总表”包含总分、平均分、最高分、最低分、自评分和去除自评平均分。
- CSV 文件可直接用 Excel 或 WPS 打开。
- 管理员可以删除某位同学的已提交记录，让其重新填写。
- 更换名单会清空当前全部评分，操作前应先导出数据。

## 隐私与限制

- 学生 API 不返回原始分数或汇总结果。
- 管理员密码使用 PBKDF2 加盐哈希保存。
- 登录 Cookie 带有签名、禁止网页脚本读取，并仅通过 HTTPS 传输。
- 名单和评分保存在 Cloudflare D1 数据库中。
- 当前版本按需求只验证姓名，无法真正确认操作者身份。知道他人姓名的人可能冒名抢先提交；发现异常时管理员可以删除该提交。
- `workers.dev` 是 Cloudflare 的海外开发域名，部分网络在关闭 VPN 后会拦截或污染 DNS。要让中国大陆网络更稳定访问，需要绑定自己的域名并按当地网络要求配置；如果没有域名，也可以继续使用 VPN 访问当前地址。

## 开发与重新发布

源码保留了本地 Node 版本和 Cloudflare 版本。普通使用不需要执行下面的命令。

安装开发依赖：

```powershell
npm install
```

启动 Cloudflare 本地模拟环境：

```powershell
npm run cf:migrate:local
npm run cf:dev
```

发布更新：

```powershell
npm run cf:deploy
```

Cloudflare 配置位于 `wrangler.jsonc`，数据库结构位于 `migrations/0001_initial.sql`。
