# 本地云测试实例

GitHub 主维护仓库：`ZZZZihan/anxin-work-rights`（私有）。Sites 远端保留为 `sites`；GitHub 使用 `origin`。修复通过分支、PR、CI 和具体验收记录推进。

目标是 `carryz@172.23.1.127`，入口为 `https://172.23.1.127:8444/`。使用已编译的 Vinext Worker，通过 Wrangler/Miniflare 的本地 D1/R2 持久化运行。这是内网测试部署，不能等同于 Cloudflare 托管生产 D1/R2 的服务保障。

## 登录与数据

- TLS 使用本机生成的自签名证书；用户第一次访问需核对证书后信任。
- 账户密码以 scrypt 哈希保存于服务器 `/home/carryz/.config/anxin/config.json`，权限 `0600`；该文件同时包含会话签名密钥。
- 工作机登录资料保存在机器私有配置目录，不进入仓库、PR 或报告。
- 会话为签名的 Secure、HttpOnly、SameSite=Strict Cookie，8 小时到期。入口清除来路身份头，再按认证账户注入身份。
- Worker 仅监听 `127.0.0.1:18797`。本地 Explorer 路径不会通过入口转发。
- D1/R2 数据目录为 `/home/carryz/.local/share/anxin/state`，独立于版本目录，重启或重新部署不清空。
- 账户从空工作台开始，不写入示例案件。

## 首次配置

在机器私有目录生成配置和登录资料：

```bash
node deploy/local-cloud/provision.mjs PRIVATE_CONFIG PRIVATE_ACCESS https://172.23.1.127:8444
```

把配置经 SSH 标准输入写入服务器私有配置目录，按目标调整证书路径并生成 IP SAN 为 `172.23.1.127` 的 TLS 证书。部署脚本不覆盖已有凭据。禁止把配置、密码或私钥加进 Git。

## 发布与检查

```bash
npm run check
git commit
bash deploy/local-cloud/deploy.sh
```

部署脚本使用当前提交的 Git archive，安装 lockfile 依赖，在 Linux 上执行 `npm run check`，应用尚未执行的 `drizzle/` 迁移，再切换 `current` 链接并重启用户级服务。脚本要求已有配置；已存在的发布目录不会被覆盖。迁移前应备份已有数据；不兼容迁移不得直接用旧代码回滚。

```bash
ssh carryz@172.23.1.127 'systemctl --user status anxin-local.service --no-pager'
ssh carryz@172.23.1.127 'journalctl --user -u anxin-local.service -n 80 --no-pager'
```

基础检查包含类型检查、lint、单元测试和构建。GitHub CI 另从迁移建立一次性 D1/R2，再执行 `scripts/http-regression.mjs`；故障注入仅允许 `/tmp/anxin-e2e-*` 下的数据库。

## 暂停、恢复与备份

暂停安薪乐业：`systemctl --user stop anxin-local.service`；恢复：`systemctl --user start anxin-local.service`。

备份 D1/R2 的完整一致快照时，先停止安薪乐业服务，再复制整个 state 目录及私有配置，完成后重新启动。不要把运行中的 SQLite 主文件单独复制当成一致备份。当前尚未配置定时备份和异机灾备。

2026-10-08 按用户要求暂停了原 Apache、One API 和 NewDay：

```bash
sudo systemctl start apache2 newday-api newday-web nginx
sudo docker start one-api
```

原数据、配置及 enabled 设置保留。这里只执行了 stop，服务器重启可能恢复原服务；恢复旧服务前先检查端口占用。

## 当前应用边界

权益助手仍是规则路径提示。文书导出的 `.doc` 是兼容 HTML 文稿；打印/PDF 依赖浏览器。实际法律内容维护、真实用户人工验收、负载、长时间运行、磁盘故障、完整数据导出和账户删除尚需后续工作。
