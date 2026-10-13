# 安薪乐业

“安薪乐业”是一个劳动权益行动工作台。当前首版把案件、证据、规则咨询和文书草稿收进一条可执行的工作流。

## 当前技术形态

- 前端：React 19 + Vinext，桌面侧边栏与手机底部导航的响应式工作台。
- 后端：Vinext Route Handlers，通过 `/api/*` 提供 JSON/HTTP 接口。
- 结构化数据：Cloudflare D1。
- 文件：Cloudflare R2，D1 仅保存文件元数据与归属。
- 身份：生产环境读取 Sites 注入的已认证用户请求头；本地预览使用明确的演示身份。

这是“同仓库、HTTP 分离”：浏览器不直接读写 D1/R2，也不依赖后端实现细节；前后端只通过 `/api/*` 的请求与响应契约交互。首版保留单工程部署，以避免过早引入跨域、两套鉴权和两条发布链路。详细设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

开发服务器会输出本地地址。本地 D1/R2 由 Miniflare 提供，首次打开为空工作台。本地演示身份只在非 production 环境可用；不会自动写入虚构案件。

开发启动会保留并升级已有本地数据库，补齐草稿修订号和文件内容哈希字段，并登记已经完成的 Wrangler 迁移；重复启动或随后显式运行本地迁移不会重复加列。不要删除 `.wrangler/state` 来升级。生产仍需按发布流程应用 `drizzle/` 迁移。

## 验证

```bash
npm run check
```

`check` 依次运行类型检查、ESLint、应用与数据生命周期测试、生产构建、公开数据库来源/索引一致性核查，以及材料处理服务测试。数据工具需要 Python 3.10 及以上。涉及 D1/R2 的修改还应在本地预览里验证完整 HTTP 闭环。

## 公开资料数据库样例

[欠薪与劳动关系确认样例 v1](data/labor-public-v1/README.md) 提供 14 个官方案例、8 部法规与 54 条相关条文，以及可离线使用的 SQLite、JSONL、原始来源、清洗和查询工具。运行 `npm run data:check` 核查发布文件，`npm run data:build` 从冻结来源重建。证据管家的材料识别面板现已接入这份资料库，展示字段原文、图片区域和可展开的案例/法条来源。

## 上传材料、识别与引用样例

完整说明见 [可运行材料样例](docs/material-demo.md)。macOS 上运行 `npm run dev:materials`，在 `http://127.0.0.1:3013` 创建案件、上传 `fixtures/material-demo` 中明确标记为合成的合同、工资到账记录或聊天图片，然后点击“识别并检索”。默认使用真实 Apple Vision OCR + 明确规则提取；可以显式选择已安装的本地模型，页面记录实际处理方式。所有候选字段需人工核对，不自动写入案件金额或文书。

识别原件经既有 D1/R2 保存，处理服务只连接本机；运行期公开索引由冻结数据库构建，不接受模型自造的案例或法条。API、失败重试、修订并发与跨账户隔离均有独立验证入口。图片/PDF OCR 依赖 macOS Vision/PDFKit；其他平台可运行 UTF-8 TXT 链路，不能将其称为已验证图片识别。

## 目录

```text
app/                    页面入口与 HTTP 路由适配器
components/             前端工作台与五个视图
lib/client.ts           浏览器端 HTTP 客户端
lib/legal.ts            可单独测试的规则路径模块
lib/server.ts           后端用例与 D1/R2 访问模块
lib/types.ts            前后端共享的请求/响应数据类型
db/schema.ts            Drizzle schema
drizzle/                可审查、按顺序应用的 D1 迁移
legacy-index.html       旧版手机演示入口，仅供对照
js/ 与 styles/          旧版演示实现，不进入新应用构建
```

## 能力边界

- “权益助手”当前是可测试的规则路径提示，不是大模型对话，不预测案件结果。
- 证据管家支持材料 OCR、可追溯字段整理与公开资料检索，不判断真伪、证据效力或案件胜率；模型、规则、用户修订及引用来源分别标注。
- 文书是可编辑草稿，用户提交前必须核对主体、金额、日期、请求和证据目录。
- 发布前必须由托管环境应用 `drizzle/` 迁移；生产请求不在运行时建表。

## GitHub 与本地云试用

主维护仓库为 GitHub 仓库 `ZZZZihan/anxin-work-rights`。修复通过分支和 PR 推进，CI 执行基础检查与隔离 HTTP 回归。本地云测试实例的部署、登录、数据目录和恢复方法见 [部署说明](deploy/local-cloud/README.md)。
