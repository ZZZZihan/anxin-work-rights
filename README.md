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

开发服务器会输出本地地址。本地 D1/R2 由 Miniflare 提供，首次打开会创建演示数据。演示身份只在非 production 环境可用。

## 验证

```bash
npm run check
```

`check` 依次运行类型检查、ESLint、规则模块测试和生产构建。涉及 D1/R2 的修改还应在本地预览里验证完整 HTTP 闭环。

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
- 证据上传保存原文件和元数据，当前不声称完成 OCR、真伪识别或证据效力判断。
- 文书是可编辑草稿，用户提交前必须核对主体、金额、日期、请求和证据目录。
- 发布前必须由托管环境应用 `drizzle/` 迁移；生产请求不在运行时建表。
