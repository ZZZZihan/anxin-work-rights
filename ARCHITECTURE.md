# 前后端分离架构

## 1. 设计结论

首版采用“同仓库、同一发布物、HTTP 契约分离”，而不是立即拆成两个独立服务。

```text
浏览器（React 工作台）
       |
       | JSON / FormData / file response
       v
HTTP seam（/app/api/* route handlers）
       |
       | 已认证用户 + 经过校验的输入
       v
应用模块（案件 / 证据 / 咨询 / 文书）
       |                         |
       | structured records      | blob bytes
       v                         v
D1 adapter                    R2 adapter
```

这个拆法已经把前端和后端的知识分开：前端只需知道 HTTP Interface，后端可以更换存储 Implementation，而无需修改视图。它又保留了一条发布链和同源鉴权，适合国创项目的首个可验收版本。

## 2. 模块与职责

### 前端工作台 Module

- Interface：`BootstrapData`、当前案件 `activeCaseId`、五个页面操作。
- Implementation：`components/AnxinApp.tsx` 和 `components/views/*`。
- 不负责：身份真实性、权限判断、业务数据持久化、文件对象 key。

### HTTP 路由 Adapter

- Interface：`/api/bootstrap`、`/api/cases`、`/api/evidence`、`/api/chat`、`/api/documents`。
- Implementation：`app/api/**/route.ts`。
- 责任：解析 Request，拒绝未认证请求，把结果翻译为 HTTP 状态码和 JSON/文件响应。
- 原则：路由保持薄，不在每个路由里复制业务规则。

### 规则路径 Module

- Interface：`buildLegalGuidance(message, activeCase)`。
- Implementation：`lib/legal.ts`。
- 特性：纯计算，不创建远程请求，可以通过输入/输出直接测试。
- 边界：它是信息整理模块，不是案情预测器。

### 持久化 Module

- Interface：`loadBootstrap`、`ensureUserSeed`、行转换函数以及 D1/R2 访问函数。
- Implementation：`lib/server.ts`、`db/schema.ts`、`drizzle/*`。
- D1 adapter：保存用户、案件、证据元数据、对话记录和文书草稿。
- R2 adapter：保存证据原文件。
- 不变量：所有读写都使用服务端得到的 `userId`，绝不信任浏览器提交的用户 ID。

## 3. HTTP 契约

| 方法 | 路径 | 用途 | 主要成功响应 |
| --- | --- | --- | --- |
| `GET` | `/api/bootstrap` | 读取当前用户工作台 | `BootstrapData` |
| `POST` | `/api/cases` | 创建案件 | `{ case }` + 201 |
| `PATCH` | `/api/cases` | 更新进度、信息或归档 | `{ case }` |
| `POST` | `/api/evidence` | 上传原文件与元数据 | `{ evidence }` + 201 |
| `DELETE` | `/api/evidence?id=...` | 删除记录与 R2 对象 | `{ ok: true }` |
| `GET` | `/api/evidence/:id/download` | 经所有权检查后下载 | 私有文件流 |
| `POST` | `/api/chat` | 保存用户问题与规则回复 | `{ messages }` + 201 |
| `PUT` | `/api/documents` | 新建或更新唯一草稿 | `{ document }` |

类型契约位于 `lib/types.ts`。当请求种类增多或需要向第三方开放时，应将其升级为显式的运行时 schema，并从同一份 schema 生成前端类型与接口文档。

## 4. 数据模型

```text
profiles (user_id)
   |
   +-- cases (id, user_id)
          |
          +-- evidence_files (case_id, user_id, object_key -> R2)
          +-- chat_messages (case_id, user_id)
          +-- document_drafts (case_id, user_id, type)
```

- `document_drafts(user_id, case_id, type)` 具有唯一索引，确保一个用户在一个案件的一种模板下只有一份当前草稿。
- 查询始终同时限定资源 ID 和 `user_id`。
- D1 迁移是生产 schema 的唯一来源；已应用的迁移不回写，后续变更追加新迁移。
- 本地 Miniflare 数据库可在开发时自动创建表，这不会在 production 执行。

## 5. 关键请求流程

### 创建案件

1. Cases 视图将表单发送到 `POST /api/cases`。
2. HTTP Adapter 从受信请求头读取用户，裁剪字段并校验必填项。
3. 持久化 Module 写入 D1，再读回刚创建的记录。
4. 前端只用服务端回传的 `case` 更新界面，不伪造成功状态。

### 上传证据

1. 后端检查案件归属、文件类型和 10 MB 限制。
2. 文件先写入 R2，再将元数据写入 D1。
3. D1 写入失败时，删除刚刚写入的 R2 对象，避免无主文件。
4. 下载时重新执行所有权检查，不将 R2 key 暴露给浏览器。

## 6. 错误、空状态和恢复

- 首页有 loading、无法读取和重试状态。
- 写操作只在 HTTP 成功后更新客户端数据。
- 咨询发送失败会把用户输入放回编辑框。
- 上传失败不添加虚假记录。
- 本地和生产都应在服务端记录真实错误，对浏览器只返回不泄露内部结构的可恢复提示。

## 7. 安全约束

- 生产环境缺少已认证用户头时返回 401，不回退到演示用户。
- 所有数据库查询都带 `user_id`所有权条件。
- 文件名去除路径分隔符与控制字符；下载设置 `nosniff` 和私有不缓存。
- 用户可见内容不承诺“胜诉率”、不把规则提示写成个案结论。
- 应用只作为信息整理与办事辅助，不替代律师、仲裁机构或人社部门意见。

## 8. 验收层次

| 层次 | 证明什么 | 不证明什么 |
| --- | --- | --- |
| 类型检查 / lint | 源码结构与常见 React 规则通过 | D1/R2 实际可读写 |
| 规则测试 | 规则路径的已冻结输入/输出正确 | 官方网站当下可访问或个案适用性 |
| 生产构建 | Vinext/Worker 可生成发布物 | 线上迁移、鉴权和资源绑定已成功 |
| 本地 HTTP 闭环 | 页面、D1 模拟和 R2 模拟能协作 | 生产数据和生产策略已验收 |
| 托管发布验收 | 真实迁移、身份头、D1/R2 绑定可用 | 法律内容获得专业人工审核 |

## 9. 后续深化顺序

1. 先为 HTTP 输入补运行时 schema，使 Interface 可生成和版本化。
2. 当出现第二个真实 Adapter（例如内存测试存储）时，再把 D1/R2 访问提取为显式 port；现在不为假设变化增加间接层。
3. 将路由级闭环测试放在 Miniflare 或托管预览上，测试 Interface 的可观察结果，不锁定 SQL 实现。
4. 如果后端需要独立扩缩容、独立权限域或被多个客户端共享，再把 HTTP seam 部署为独立 Worker；到时保持契约，前端实现无需重写。

当前不建议首版就引入微服务、消息队列、多仓库或两套用户系统：它们会扩大 Interface，却不会增加当前业务能力。
