# dsh-browser-mode

DSH 插件：在 Windows 桌面端标题栏「重启」旁加一个「浏览器模式」按钮，点一下就把浏览器登进 DeepSeek Harness 的网页界面。

## 这是什么问题

桌面端用 `?token=` 的一次性 URL 打开网页端，那个 URL 只经 IPC 交给 Electron 窗口，不落盘；直接访问 `http://127.0.0.1:<port>/` 只会看到 `dsh web authentication required`。浏览器会话 cookie 的签名密钥是持久化的（`~/.dsh/.credentials.yaml` 里的 `client-connection/browser-session`），所以 Host 侧可以自己铸一个等价 cookie。本插件就做这件事：按下按钮 → 检查请求浏览器是否已有有效 cookie → 没有就现场铸一个 7 天 cookie，用一次性链接（`/dsh-browser-mode/login?n=…`，2 分钟、单次、内存 Map）通过 `Set-Cookie` 装进浏览器并 303 到 `/` → 顺便打开默认浏览器。

## 目录

| 路径 | 作用 |
|---|---|
| `index.js` | Host 侧：三条路由 `/dsh-browser-mode/open`（POST，需 `x-dsh-browser-mode: 1` 头）、`/login`、`/state`；铸 cookie、签一次性链接、跨平台开浏览器、日志写 `~/.dsh/dsh-browser-mode.log` |
| `client.js` | 前端：`window.__ModuleLoader__.load(...)`，往 `[data-windows-menu]` shadow root 的 menubar 里插按钮（紧挨 `[data-dsh-restart]` 之后），自建 shadow DOM 对话框 |
| `cordis.patch.yml` | bundle 补丁：`- insert: [{id: dsh-browser-mode, name: 'dsh-browser-mode'}]` |
| `package.json` | `dsh.bundle.patch` + `dsh.client`（platform web / immediately / inject `@deepseek-ai/dsh-client-ui-conversation`）+ `dsh.engines.dsh >=0.2.0-rc.1` |
| `locale/{zh,en}.json` | 插件页标题/描述 + `meta.detail` 指向 `docs/DETAIL*.md` |
| `docs/DETAIL*.md` | **只能有一行** `![alt](preview.svg)`（插件市场的硬要求） |
| `assets/screenshot-titlebar.png` + `screenshots.json` | 市场卡片截图（1 张，标题栏） |
| `.secrets/github-token.txt` | GitHub token，**已在 .gitignore 里，永远不要提交** |
| `.marketplace/dsh-browser-mode.yml` | 给 awesome-dsh-plugin 的市场条目（本地草稿） |

## 日常改法与验证

```powershell
# 改完代码必须让 plugin_manager 重新加载（linked 目录不会热更新 Host 侧）
plugin_manager set_bundle target=dsh-browser-mode enabled=false
plugin_manager set_bundle target=dsh-browser-mode enabled=true

# 三个验证点
Invoke-WebRequest http://127.0.0.1:59579/dsh-browser-mode/state      # 期望 status=ok
# 点标题栏按钮，日志里应有 "minted a 7-day cookie …"
Get-Content ~/.dsh/dsh-browser-mode.log -Tail 5
# 浏览器掉进 401 时，按按钮应当直接放行而不是再报 401
```

没有构建步骤，没有依赖，纯 ESM。发布：`npm publish --access public`（token 已在 npm 配置里；新包首次会先出现 `0.0.0-stage` 占位，等一两分钟）。

## 坑（都踩过了）

1. **不能读 `ctx.config`**，除非声明了 `Config`：`Error: cannot get property "config" without inject`。天数直接用常量 `DEFAULT_MAX_AGE_DAYS`。
2. **`Credentials` 服务的 API**：`ctx.get('credentials').readRecord('client-connection/browser-session')` 返回 `{kind:'grant', payload:{version:1, secret:<base64url 32B>}}`。别去解析 YAML。
3. **cookie 语法必须与官方一致**：name = `dsh-auth-` + b64url(sha256(authority))；value = `v1.<b64url(JSON{version,authority,issuedAt,expiresAt})>.<b64url(HMAC-SHA256(secret, body))>`；`HttpOnly; SameSite=Strict; Path=/`。
4. **pnpm 换源时报 EPERM**：profile 里残留的目录链接不能用 `rmdir` 以外的办法删；先 `cmd /c rmdir <profile>\node_modules\dsh-browser-mode` 再装。
5. **PowerShell 5.1 的 `Invoke-WebRequest -Headers @{Cookie=…}` 会丢 Cookie**，必须用 `WebRequestSession` + `System.Net.Cookie`。
6. **`git push` 的认证**：用 `-c http.extraHeader="Authorization: Basic <base64(Tino0713:token)>"`，`bearer` 不认；token 别写进 remote URL。
7. 本机到 github.com 的 git 通道时断时续，`api.github.com` 通常正常——HTTP 断的时候可以走 REST API 提交。
8. **端口一变就不再自动签入**（0.1.3 修）：旧版 `/open` 拿「发起请求的窗口」自己的 cookie 判断是否已登录——Electron 外壳永远持有当前 authority 的有效 cookie，于是它只开 `http://<authority>/`、不发登录链接，默认浏览器在新端口没有 cookie，结果就是 401。现在 `/open` 每次必铸链接，登录路由按**浏览器自己的** cookie 决定要不要 Set-Cookie。
9. 本机沙箱里 `node --test test/` 会 `spawn EPERM`（禁止子进程），直接 `node test/browser-mode.test.mjs` 跑；npm 必须加 `--cache .npm-cache`，否则写 AppData 缓存被拒。git 走 HTTPS 在这台机器上 schannel/openssl 都会失败，发版走 REST API 或 `gh api`。

## 当前状态（2026-11-27）

- 本地已装（linked，指向 `D:\github\dsh-browser-mode`——profile 里是指向它的 junction，重载前得先把改动同步到那份 clone），已端到端验证：按钮可见、铸 cookie、浏览器真正兑换成功；端口 63969 上实测「首次发 cookie / 再次识别已有 cookie」两条路径。
- GitHub：`Tino0713/dsh-browser-mode`，`main` 已推到本次修复提交，tag `v0.1.3` + release。
- npm：`dsh-browser-mode@0.1.3`（`repository` 指回仓库，市场靠这个关联）。
- 市场 PR：`awesome-dsh-plugin/awesome-dsh-plugin#17152`（加 `data/plugins/Tino0713__dsh-browser-mode.yml`）。仓库是当天新建的，**CI 的「仓库满 1 天」门槛会自动过期重跑**，不要为此重新提 PR。
- 未做：市场卡片目前只有一张标题栏截图；对话框、状态行的截图可以补。
