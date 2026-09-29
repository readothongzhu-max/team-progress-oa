# 同频 · 项目进度 OA

为 10 人以下、每人并行负责多个项目的团队制作。先在 Windows 本地使用，同一份应用可部署到 Linux Docker。

## 首次使用

本机地址：<http://127.0.0.1:3210>

初始管理员账号为 `admin`。首次启动时生成随机密码，保存在 `data/initial-access.txt`，没有通用默认密码。首次登录后使用侧栏的“修改密码”；修改成功后初始密码文件会自动移除。

1. 在“团队管理”添加成员，老板使用管理员角色。
2. 新建项目，填写负责人、阶段、完成度和预计交付日期。本地项目不填写 GitHub 仓库。
3. 每周点击“写周报”，填写本周完成、下周计划，更新完成度与成果链接。
4. 周会直接使用项目卡片或“汇报模式”。点击项目名称查看完整周报、历史记录和开发动态。

卡片右上方可选择“按等级：高 → 低”或“按名称：拼音 / A–Z”。默认按高、中、低排列，同等级按名称排列，未设置等级的项目排最后。等级读取项目简介中独立的“优先级：高／中／低”行（兼容繁体“優先級”）；导入项目已保留该字段。排序选择会在当前浏览器记住，筛选、重新加载和“我的项目”沿用同一选择。

不预置虚构项目或成员。浏览器验收使用独立数据目录，不会混入正式数据。经用户要求，可将 Google 表格中的真实项目导入；导入快照、账号信息及回执只保存在被版本库忽略的 `data/imports/` 中。

## 本地启动与停止

需要 Node.js **24.15 或更新的 24.x LTS**。没有额外 npm 运行时依赖，不需要安装数据库服务或编译前端。

在项目目录运行：

```powershell
npm start
```

需要后台运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

关闭后台服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

默认仅监听本机 `127.0.0.1:3210`。可复制 `.env.example` 为 `.env` 修改配置。后台脚本提示默认端口；自定义端口以 `.env` 和 `data/server.log` 为准。

## 已实现的规则

- 成员可查看全部项目，只能创建和编辑自己负责的项目、周报；管理员可管理全部项目与账号，也可转交负责人。
- 项目阶段：想法、开发中、测试中、已上线、暂停。完成度由负责人填写 0～100%，独立于阶段。
- 来源没有填写阶段或完成度时，保留“待确认／未填写”，不会以 0% 或“想法”冒充实际状态。填写周报前需确认阶段和完成度；只编辑项目其他字段不会清空或补造进度。
- 周报按 **Asia/Shanghai** 的周一至周日归档；每个项目每周一份，本周可反复修改，历史周报保留当时的阶段、完成度、交付日期和成果链接。跨周提交会提示重新打开表单。
- “本周待更新”指尚无本周周报的未上线、未暂停项目；修改项目资料或同步 GitHub 不会消除该提示。
- 交付日当天不逾期，上海时间次日开始逾期；“已上线”不再显示逾期。“暂停”仍保留原定日期的逾期提示，负责人可调整日期。
- 导入时阶段“待确认”的项目不直接判定逾期：原计划日期照录，确认当前阶段后再判断延期。
- 成果支持带名称的网页、演示、截图分享地址等链接，每项目最多 8 个。不直接上传本地图片或附件。
- GitHub 显示默认分支最近 5 次提交和最后提交时间，每 15 分钟自动同步，也可手动刷新；同一项目 30 秒内重复刷新复用结果。
- 只读同步不更改完成度、不生成周报。出错时保留上次成功数据，并展示同步失败原因。
- 账号使用 scrypt 密码哈希；会话为 HttpOnly / SameSite Cookie，写操作校验 Origin 与 CSRF。GitHub 凭据加密保存，接口不返回密码或 Token。

## GitHub 私有仓库配置

管理员打开“GitHub 设置”，保存 Fine-grained personal access token。选择正确的资源所有者和所需仓库，仓库权限授予 **Contents: Read-only**（Metadata 为附带的读取权限）。需要组织审批时，先完成审批。

可以按仓库 owner（个人或组织）分别保存凭据，也可留空设为默认凭据。匹配顺序：**owner 专用凭据 → GITHUB_TOKEN 环境变量 → 界面保存的默认凭据 → 匿名访问**。填写项目仓库支持 `owner/repo` 或 `https://github.com/owner/repo`。

原生 GitHub API，不依赖用户浏览器登录 GitHub。公开仓库可匿名获取；私有仓库只有在配置真实凭据后才能验证实际授权。

官方参考：[List commits](https://docs.github.com/en/rest/commits/commits#list-commits)、[Token 管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

## Linux Docker 部署

把此项目的源文件复制到服务器，不要公开 `data/`、`.env` 或备份目录。需要迁移本地数据时，按下面的备份与恢复操作。

1. 安装 Docker Engine 与 Compose。
2. 复制 `.env.example` 为 `.env`。设置实际访问域名和 HTTPS Cookie：

```dotenv
APP_ORIGIN=https://progress.example.com
COOKIE_SECURE=true
```

3. 构建并启动：

```bash
docker compose up -d --build
docker compose logs --tail=30
```

4. 按 `deploy/nginx.conf.example` 接入现有 Nginx 与有效 HTTPS 证书；替换示例域名和证书路径。Compose 只将端口暴露给服务器本机，由反向代理提供团队访问入口。`APP_ORIGIN` 必须与浏览器访问地址完全一致（不带末尾斜杠），否则写操作会被拒绝。
5. 在服务器读取首次登录信息：

```bash
docker compose exec oa cat /app/data/initial-access.txt
```

无需域名、只在服务器上本地试运行时，可以先保留 `COOKIE_SECURE=false` 和 `APP_ORIGIN=http://localhost:3210`，再通过 SSH 端口转发访问 `http://localhost:3210`。

数据保存在命名卷 `oa_data`；重建镜像或 `docker compose down` 不会删除数据，**不要使用 `docker compose down -v`**，它会删除数据卷。本应用为单实例 SQLite 服务，不要启动多个应用副本共享同一数据库。

## 备份和迁移

本地运行：

```bash
npm run backup
```

备份存入 `backups/时间戳/`，包含数据库和加密密钥；使用 SQLite 在线备份 API，可以在应用运行时执行。不要只复制运行中的 `team.sqlite`，WAL 中可能还有已保存内容。

容器内备份：

```bash
docker compose exec oa node scripts/backup.mjs
```

然后将输出的备份目录复制到服务器持久保存的位置，例如：

```bash
docker compose cp oa:/app/backups/输出的目录名 ./oa-backup
```

恢复或从本地迁移到服务器：

1. 停止目标应用。将目标原有数据完整另存。
2. 将备份中的 `team.sqlite` 与 `encryption.key` **一起**放入新的空数据目录。不要将旧的 `team.sqlite-wal` 或 `team.sqlite-shm` 混入恢复目录。
3. Docker 可先创建未启动的容器并复制文件到命名卷：

```bash
docker compose create
docker compose cp ./oa-backup/. oa:/app/data/
docker compose run --rm --no-deps --user root oa chown -R node:node /app/data
docker compose up -d
```

恢复的数据包含原来的账号密码，使用原账号登录。丢失 `encryption.key` 将无法解密已保存的 GitHub 凭据。备份包含敏感信息，需按团队内部资料妥善保存。

## 检查

```bash
npm run check
npm test
```

自动测试覆盖时区周界、交付日期、登录/CSRF、权限越权、账号停用、周报保存与历史快照、重启持久化，以及模拟的 GitHub 公开/私有授权、失败保留、凭据加密和 owner 选择。浏览器验收记录见 `验收说明.md`。
