# 纯合成 HTTP 验收

这是独立合成数据入口，支持默认限时运行与显式持续展示，唯一部署目标为 **carryz Debian 12 / 172.23.1.127**。Z820 `172.31.125.123` 只是可选的第二验证来源。它不复用现有 HTTPS 8444 的账号、密钥、配置、D1 或 R2，也不更改 `deploy/local-cloud` 的 HTTPS 要求。

HTTP 的内容、合成密码和会话可被网络中的人抓包或篡改。只输入合成资料，不复用真实密码。默认登录模式在登录页及业务页提示这一限制。使用独立浏览器 profile；端口不同不能隔离 Cookie。合成 Cookie 使用随机独立名称与签名密钥，真实 HTTPS 的 Secure Cookie 不会发到 HTTP，但合成 Cookie 仍可能发到同 IP 的 HTTPS，真实网关忽略它。

显式设置 `directEntry: true`（创建参数 `--direct-entry true`）可直接进入首页。此模式共享已有 `synthetic-a` 的虚拟记录，忽略遗留登录 Cookie，以虚构人物林晓展示账户资料，隐藏登录、退出、认证宣传和环境提示。默认关闭；来源、Host、Origin、请求头剥离及限时模式的绝对到期限制仍生效。切换已有环境时保留原 root、用户 ID、密钥、状态与截止时间，只正常重启网关。真实 HTTPS 网关不使用此选项。

需要持续展示时，显式添加 `--persistent-demo true`，并同时设置 `--direct-entry true`。此时标记和配置的 `persistentDemo` 均为 true、`expiresAt` 均为 null，不创建自动到期计时器，由操作者主动停止。服务管理器的网关、专用代理和启用的材料伴随服务单元也必须取消 RuntimeMaxSec 限制。升级已有展示账号保留同 root、用户 ID、密钥与记录，仅同步生命周期元数据及新 release；不要创建空实例。默认登录和限时直接进入模式仍受原四小时上限约束。持续展示只取消运行期限；transient unit 不等于开机自启，不能据此声称机器重启后的服务恢复已验证。

## 本机隔离回归

```sh
npm run check
node scripts/synthetic-http-regression.mjs /tmp/synthetic-http-results.json
node deploy/synthetic-http/environment.mjs create
# 只复制上一命令返回的新 root 路径，不打印 config.json 或 access.json。
node deploy/synthetic-http/server.mjs ROOT
```

默认入口为 `127.0.0.1:18090`，内部 Worker 固定绑定 `127.0.0.1:18897`、使用 `--local`。端口被占用时失败；就绪必须验证本次子进程及环境 ID，不能把其他 Worker 的 401 当成功。每次新建均生成随机独立账号 ID、会话密钥、Cookie 名、D1 ID、R2 名与新状态目录。默认限时环境最长存活 4 小时，会话最多 30 分钟且不超过环境截止时间，服务到期自行关闭；显式持续展示遵循前述 `persistentDemo` 规则。升级已有环境不重新生成这些身份和数据。

新 root 的 `access.json` 含两组短期合成密码，私存模式 0600，整个 root 为 0700。不要复制到 Git、日志、Issue 或 PR。关闭后，用创建返回的精确 ID 清理：

```sh
node deploy/synthetic-http/environment.mjs remove ROOT ENVIRONMENT_ID
```

清理只接受临时目录或 `/home/carryz/.local/share/anxin-synthetic` 下按规则生成并且标记匹配的 root；拒绝符号链接、重定向路径、已有真实目录、错误 ID 和活跃 `.runtime.json`。不会自动删除过期但仍标记活跃的目录。若启动异常留下标记，先核实本实例进程及端口已停止，再人工处理标记，不能强行清理未知实例。

localhost 是安全上下文。上传回归还需用真实 Chrome 的离线路由 `route.fulfill` 提供普通 HTTP 域名，确认 `isSecureContext === false`、`crypto.randomUUID` 不存在时，`getRandomValues` 生成的 UUIDv4 仍能上传并保持重试 ID；这是浏览器行为测试，实际 LAN 浏览器验收另行记录。

## 可选本机材料服务

已创建的 synthetic root 可增加私有 `material-service.json`，仅包含 `url` 与 `token`。root 保持当前账户所有、真实目录和 0700；文件须为同一账户所有的 0600 普通文件，不能使用软链接或硬链接。不读取其他项目配置。没有此文件时，Worker 仍使用原有环境变量和 D1/R2 配置。

`url` 仅允许 `http://127.0.0.1:PORT`（可带最后一个 `/`），端口 1024–65535；不接受其他主机、HTTPS、用户名/密码、业务路径、查询或片段。端口不能与本环境 gateway/Worker 或独立 HTTPS 的 8444/18797 冲突。`token` 使用私有进程生成的随机 hex 或 base64url 字符串，长度 32–128，只含字母、数字、`_` 和 `-`；不要打印、放进命令行参数或提交仓库。伴随服务读取同一私有配置，固定监听该回环端口；网关不增加浏览器直连路由。

修改配置前停止本次精确 gateway 和材料伴随服务单元，并一致备份整个 root，包括 `worker.json`、材料配置和 state。启动器只允许把逐字匹配的原 Worker 配置升级为新增两个材料变量的已知配置，或在同一个服务地址轮换合法令牌；数据库、R2、环境 ID、入口、静态资源和其他配置差异均拒绝。已运行的 `.runtime.json` 存在时不改 Worker 配置。轮换后应用与伴随服务必须读取同一份配置重新启动。地址变更或关闭材料接入须按已核验备份同步恢复材料配置与 Worker 配置，不能只删除材料文件后直接启动旧版。

材料 URL/token 只写入 root 的私有 Worker 配置，不进入 bwrap argv 或公开 readiness/bootstrap。`--clearenv` 继续清空外部环境，`--share-net` 让隔离 Worker 连接主机回环 sidecar。Wrangler dev 的 stdout/stderr 丢弃、日志级别为 none、磁盘日志与遥测关闭；迁移输出仅在进程内接收，失败时返回不含原 stdout/stderr 的固定错误，不能把原异常或私有配置追加到 journal/报告。就绪仍验证本次 Worker 与环境 ID；材料引擎能力及完整识别闭环须另行验收。

网关接线不会安装 OCR 或自行启动伴随服务。Linux 图片/PDF 依赖本机 Tesseract `chi_sim` 与 Poppler；运维可通过绝对路径的 `ANXIN_TESSERACT_BIN`、`ANXIN_TESSDATA_PREFIX` 和私有库路径 `ANXIN_TESSERACT_LIBRARY_PATH` 配置已有工具，具体约束见[材料提取服务说明](../../docs/material-extractor.md)。在主机上独立启动伴随服务，再启动隔离网关：

```sh
node deploy/synthetic-http/material-sidecar.mjs ROOT
```

该启动器读取同一 root 的私有配置，确认回环 listener 和中文 OCR/PDF 能力就绪，固定使用 OCR + 规则，不启用 Ollama 或 Apple 文字模型。令牌不放入 argv、环境变量或启动日志；伴随服务与网关分别由本次精确服务单元管理。缺少引擎时启动明确失败；服务中断时应用显示可重试失败并保留原件。

## 目标机 80 端口部署

用新提交构建独立 release 到 `/home/carryz/.local/lib/anxin-synthetic/releases/SHA`。合成 HTTP 与现有 HTTPS 8444 的 release、配置、状态和账号保持独立。下面的 `create` 示例只用于首次新建专用环境，外部 origin 与回环 listener 显式分离：

```sh
node deploy/synthetic-http/environment.mjs create \
  --base-dir /home/carryz/.local/share/anxin-synthetic \
  --release SHA --ttl-minutes 240 \
  --public-origin http://172.23.1.127 \
  --allow-cidr 172.23.1.0/24 --allow-cidr 172.31.125.123/32
node deploy/synthetic-http/nginx-config.mjs ROOT
node deploy/synthetic-http/isolated.mjs RELEASE ROOT
```

本次整合升级沿用已有合成 HTTP 的数据 root，不执行 `create`。切换前停止本次精确单元并取得一致备份；保留原环境 ID、用户、密钥、Cookie、D1/R2 状态与原件，保留仍被已有页面引用的静态资源及可回退 release。将配置切换到新 release，使用同一私有材料配置启动伴随服务与隔离网关；网关启动时受控升级 Worker 配置，并按顺序应用 `drizzle/` 迁移。回滚恢复已核验的 release 和配套 Worker/材料配置，不能用切换前的整份 state 覆盖切换后新增的数据。

直接 LAN listener 也要求显式单个 RFC1918 IPv4 和来源 CIDR，不能用 `0.0.0.0`、IPv6 全接口或默认所有网络。代理模式仅允许回环 listener，校验新代理密钥及 Nginx 覆盖写入的真实来源头；客户端不能自行伪造身份或代理来源。精确 Host 和修改请求的 Origin 均校验。

**Nginx 必须使用生成的完整独立配置，不 include 既有配置。** 将 `ROOT/nginx.conf` 安装到 `/run/anxin-synthetic-ENVIRONMENT_ID/nginx.conf`：父目录 root:root 0700，文件 root:root 0600，普通用户不可写。随后只执行 `nginx -t -c`（勿用会打印代理密钥的 `-T`），用独立 transient unit 前台运行该配置，并按限时或持续展示模式设置运行期限。主进程绑定 `172.23.1.127:80`，worker 降权为 www-data，上传限制及超时匹配网关。不要启动既有 nginx unit，不激活 `newday.conf`，不更改其文件、enable 状态、全局防火墙、sysctl、二进制 capability 或证书信任。

网关必须通过已有 bwrap 启动，失败就停止，不退回裸进程，也不代理真实 HTTPS 8444。隔离清空环境、使用新的 PID/mount/user namespace、丢弃 capabilities，仅挂载只读 release 和准确 Node 二进制（到 `/runtime/node`），持久写入仅限本次选定的 synthetic root；系统公共运行库只读，`/tmp`、`/run` 为临时挂载。真实 `/home/carryz/.config/anxin` 和 `/home/carryz/.local/share/anxin` 不挂载。在实际 namespace 内启动前自检路径为 ENOENT、新 PID namespace、CapEff 为零、release 只读和选定 root 可写，失败则关闭。离线 argv 测试不能代替目标机 namespace 自检。

默认限时环境的网关与专用 Nginx 均设最长 4 小时运行期限，不 enable 持久服务。显式持续展示时，网关、专用 Nginx 和启用的材料伴随服务均取消 RuntimeMaxSec 限制；仍为 transient unit，不包含开机自启或整机重启恢复承诺。

网关 transient unit 使用 `KillMode=mixed`、`TimeoutStopSec=12`：TERM 仅发给 launcher，由本实例私有 stdin 管道请求内部网关优雅停止，超时才强制结束并报告失败。保留 bwrap 的 PID1 reaper；自然到期不会被控制管道保持存活。材料伴随服务使用自己的精确单元，在取消 OCR 子进程并完成临时目录清理后退出；Nginx 单元可使用 `KillMode=control-group`。停止时只操作本次精确单位名和 root；保留现有 HTTPS 8444、SSH、Tailscale、数据库与旧网站文件。如果 80 被未知服务占用，先确认，不接管未知进程。

当前批准来源为 `172.23.1.0/24` 和 `172.31.125.123/32`。Mac 的 SSH 在目标端曾观察为 NAT 来源 `219.243.58.55`；该额外 `/32` 必须另获明确授权，不能自动加入。来源 IP 可能共享 NAT，不代表唯一物理设备。来源未批准时，记录拒绝及浏览器限制；不得冒充来源、忽略证书或宣称 LAN 浏览器验收完成。

原隔离 HTTP 工作由 Issue #11 跟踪；本次整合由 Issue #25 与 PR #26 记录。原 Issue #8 的生产备份、异机恢复、容量及真实用户试用仍独立未完成。

Linux OCR、私有材料接线和升级路径已经实现；本次新版界面与材料处理的整合部署已完成网站验收。实际候选、服务运行、HTTP/浏览器检查、数据与原件保全及恢复结果以[本次发布验证记录](../../docs/validation/material-live-20261013/README.md)为准。已有合成样例与模型验证记录按原范围保留，不把 OCR + 规则的结果作为 Ollama/VLM 通过证据。
