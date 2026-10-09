# 纯合成 HTTP 验收

这是短期合成数据入口，唯一部署目标为 **carryz Debian 12 / 172.23.1.127**。Z820 `172.31.125.123` 只是可选的第二验证来源。它不复用现有 HTTPS 8444 的账号、密钥、配置、D1 或 R2，也不更改 `deploy/local-cloud` 的 HTTPS 要求。

HTTP 的内容、合成密码和会话可被网络中的人抓包或篡改。只输入合成资料，不复用真实密码。默认登录模式在登录页及业务页提示这一限制。使用独立浏览器 profile；端口不同不能隔离 Cookie。合成 Cookie 使用随机独立名称与签名密钥，真实 HTTPS 的 Secure Cookie 不会发到 HTTP，但合成 Cookie 仍可能发到同 IP 的 HTTPS，真实网关忽略它。

显式设置 `directEntry: true`（创建参数 `--direct-entry true`）可直接进入首页。此模式共享已有 `synthetic-a` 的虚拟记录，忽略遗留登录 Cookie，界面显示访客并隐藏认证和环境提示。默认关闭；来源、Host、Origin、请求头剥离及绝对到期限制仍生效。切换已有环境时保留原 root、用户 ID、密钥、状态与截止时间，只正常重启网关。真实 HTTPS 网关不使用此选项。

## 本机隔离回归

```sh
npm run check
node scripts/synthetic-http-regression.mjs /tmp/synthetic-http-results.json
node deploy/synthetic-http/environment.mjs create
# 只复制上一命令返回的新 root 路径，不打印 config.json 或 access.json。
node deploy/synthetic-http/server.mjs ROOT
```

默认入口为 `127.0.0.1:18090`，内部 Worker 固定绑定 `127.0.0.1:18897`、使用 `--local`。端口被占用时失败；就绪必须验证本次子进程及环境 ID，不能把其他 Worker 的 401 当成功。每次创建均生成随机独立账号 ID、会话密钥、Cookie 名、D1 ID、R2 名与新状态目录。最长存活 4 小时，会话最多 30 分钟且不超过环境截止时间。服务到期自行关闭。

新 root 的 `access.json` 含两组短期合成密码，私存模式 0600，整个 root 为 0700。不要复制到 Git、日志、Issue 或 PR。关闭后，用创建返回的精确 ID 清理：

```sh
node deploy/synthetic-http/environment.mjs remove ROOT ENVIRONMENT_ID
```

清理只接受临时目录或 `/home/carryz/.local/share/anxin-synthetic` 下按规则生成并且标记匹配的 root；拒绝符号链接、重定向路径、已有真实目录、错误 ID 和活跃 `.runtime.json`。不会自动删除过期但仍标记活跃的目录。若启动异常留下标记，先核实本实例进程及端口已停止，再人工处理标记，不能强行清理未知实例。

localhost 是安全上下文。上传回归还需用真实 Chrome 的离线路由 `route.fulfill` 提供普通 HTTP 域名，确认 `isSecureContext === false`、`crypto.randomUUID` 不存在时，`getRandomValues` 生成的 UUIDv4 仍能上传并保持重试 ID；这是浏览器行为测试，实际 LAN 浏览器验收另行记录。

## 目标机 80 端口部署

用新提交构建独立 release 到 `/home/carryz/.local/lib/anxin-synthetic/releases/SHA`。不要复用现有工作台的 release、配置、状态或账号。创建专用环境，外部 origin 与回环 listener 显式分离：

```sh
node deploy/synthetic-http/environment.mjs create \
  --base-dir /home/carryz/.local/share/anxin-synthetic \
  --release SHA --ttl-minutes 240 \
  --public-origin http://172.23.1.127 \
  --allow-cidr 172.23.1.0/24 --allow-cidr 172.31.125.123/32
node deploy/synthetic-http/nginx-config.mjs ROOT
node deploy/synthetic-http/isolated.mjs RELEASE ROOT
```

直接 LAN listener 也要求显式单个 RFC1918 IPv4 和来源 CIDR，不能用 `0.0.0.0`、IPv6 全接口或默认所有网络。代理模式仅允许回环 listener，校验新代理密钥及 Nginx 覆盖写入的真实来源头；客户端不能自行伪造身份或代理来源。精确 Host 和修改请求的 Origin 均校验。

**Nginx 必须使用生成的完整独立配置，不 include 既有配置。** 将 `ROOT/nginx.conf` 安装到 `/run/anxin-synthetic-ENVIRONMENT_ID/nginx.conf`：父目录 root:root 0700，文件 root:root 0600，普通用户不可写。随后只执行 `nginx -t -c`（勿用会打印代理密钥的 `-T`），用独立限时 transient unit 前台运行该配置。主进程绑定 `172.23.1.127:80`，worker 降权为 www-data，上传限制及超时匹配网关。不要启动既有 nginx unit，不激活 `newday.conf`，不更改其文件、enable 状态、全局防火墙、sysctl、二进制 capability 或证书信任。

网关必须通过已有 bwrap 启动，失败就停止，不退回裸进程，也不代理真实 HTTPS 8444。隔离清空环境、使用新的 PID/mount/user namespace、丢弃 capabilities，仅挂载只读 release 和准确 Node 二进制（到 `/runtime/node`），持久写入仅限新 synthetic root；系统公共运行库只读，`/tmp`、`/run` 为临时挂载。真实 `/home/carryz/.config/anxin` 和 `/home/carryz/.local/share/anxin` 不挂载。在实际 namespace 内启动前自检路径为 ENOENT、新 PID namespace、CapEff 为零、release 只读和新 root 可写，失败则关闭。离线 argv 测试不能代替目标机 namespace 自检。

网关与专用 Nginx 均设最长 4 小时运行期限，不 enable 持久服务。网关 transient unit 使用 `KillMode=mixed`、`TimeoutStopSec=12`：TERM 仅发给 launcher，由本实例私有 stdin 管道请求内部网关优雅停止，超时才强制结束并报告失败。保留 bwrap 的 PID1 reaper；自然到期不会被控制管道保持存活。Nginx 单元可使用 `KillMode=control-group`。停止时只操作本次精确单位名和 root；保留现有 HTTPS 8444、SSH、Tailscale、数据库与旧网站文件。如果 80 被未知服务占用，先确认，不接管未知进程。

当前批准来源为 `172.23.1.0/24` 和 `172.31.125.123/32`。Mac 的 SSH 在目标端曾观察为 NAT 来源 `219.243.58.55`；该额外 `/32` 必须另获明确授权，不能自动加入。来源 IP 可能共享 NAT，不代表唯一物理设备。来源未批准时，记录拒绝及浏览器限制；不得冒充来源、忽略证书或宣称 LAN 浏览器验收完成。

Issue #11 与新 Draft PR 跟踪本项。原 Issue #8 的生产备份、异机恢复、容量及真实用户试用仍独立未完成。
