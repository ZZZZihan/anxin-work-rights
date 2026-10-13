# 材料样例验证记录

验证日期：2026-10-13。本目录将应用行为、真实 OCR、真实模型调用、独立技术复核和历史失败分别记录。输入全部为 `fixtures/material-demo` 中明确标注的合成材料；未使用真实当事人资料，未进行法律专家或用户人工验收。

最终源文件 SHA-256 见 `candidate-manifest.json`，数据依赖为 PR #22 的 `da689eb00827faa68abc524377978c021c6a4e74`。公开数据 fingerprint 保持 `e599f7f44e0350378c8369a0bf98932ffb15c111bd7d2d867402584104d8ad7a`，未改动冻结数据。

## 应用与默认 OCR 路径

| 范围 | 实际结果 | 记录 |
| --- | --- | --- |
| 类型、ESLint、生产构建 | 通过 | `local-check.txt` |
| 应用单元与 D1/R2 生命周期 | 10 个文件、67 项通过 | `local-check.txt` |
| 数据完整性与清洗检查 | 9 项通过，运行索引一致 | `local-check.txt` |
| 本机材料服务 | 13 项通过，0 跳过；包含真实 Vision OCR，故障注入不冒充模型推理 | `local-check.txt` |
| 原有应用生产 HTTP | 21 项通过，隔离 D1/R2 | `http-baseline.json` |
| TXT 生产 HTTP | 5 项通过，真实 UTF-8 和规则提取 | `http-production.json` |
| 三类 PNG 与扫描 PDF 生产 HTTP | 14 项通过，真实 OCR 和规则提取，逐项核对已知合成字段 | `http-images.json` |

材料 HTTP 回归检查上传、字节哈希、OCR 原文、字段语义、案例与法条引用、账户隔离、核对保存、过期修订 409、删除后 404、无关查询空结果与自然语言劳动权益查询。隔离状态测试完清理；生产构建在本地运行，不等于线上部署或生产验收。

## 真实模型与保留的失败

本机 Apple 模式实际执行 OCR 后的文字模型调用，`local_text_model`、`imageCount=0`。这不是视觉大模型直接理解图片的验证，也没有可核验的系统模型版本 digest。最终一轮真实模型 HTTP 14 项通过：合同 PNG 5 字段、工资 PNG 4 字段、聊天 PNG 3 条陈述、合同 PDF 5 字段；主 Agent 逐项检查 17 个接受字段及出处。约 30.48 秒、内存压力一直为 1、swap 无增加。见 `summary.json`、`http-apple-images.json` 和 `http-apple-resources.json`。

以下失败没有删除或改写为成功：

- `model-probes.json`：27B 视觉模型探针触发内存停止条件，无有效字段，不能称为 VLM 成功；Apple 最初的引用格式问题也单独记录。
- `http-apple-before-semantic-filter.json`：HTTP 链路完成，但人工发现标题、声明、工资月份等语义误标，`qualityStatus=FAILED_MANUAL_SEMANTIC_REVIEW`。
- `http-apple-semantic-filter-missing-management.json`：语义过滤后合同 5 字段、工资 4 字段正确；聊天正确提取劳动者及两条欠薪陈述，但漏掉工作管理安排，因此严格验收失败。原始 OCR 和出处仍完整保留。

语义约束只拒绝不支持的候选，不由规则补齐模型结果。提示修正在相同公开合成夹具上迭代，最终通过也只能说明这组受控样例，不是独立留出集评估、真实材料准确率或法律适用准确率。

## 浏览器与技术复核

真实浏览器执行上传、识别、字段修订、勾选核对、保存后刷新、图像区域定位、展开案例/条文出处、390px 手机显示、无关检索、损坏图片失败及删除操作。旧规则模式页面截图与最终模型页面分别保存，不混称为同一次模型运行。

- `desktop-source-location.png`：合同工资字段与原图位置。
- `mobile-citations.png`：手机端展开出处。
- `mobile-chat-fields.png`：聊天规则字段与相关资料。
- `mobile-invalid-file.png`：损坏图片错误与重试入口。
- `desktop-apple-wage-location.png`：最终 Apple 文字模型工资字段与原图位置。
- 最终模型页面及逐项检查见 `browser-final.json`。

`material-independent-review.json` 由未实施应用集成的 Agent 复核 API、状态竞争、前端契约和 HTTP 断言；`material-service-review.json` 由未实施处理服务的 Agent 复核提取、引用与清理。报告保留各自文件哈希和检查范围，模型实际结果以主 Agent 的真实调用记录为准。三个子 Agent 请求配置均为 GPT-6.1 Sol / ultra；工具未独立暴露每次实际运行配置，不能将请求参数视为运行核验。

启动和能力限制详见 [使用说明](../material-demo.md)。本次没有合并、部署或公开发布。GitHub PR 的 CI 状态以该 PR 的实际检查为准；本地通过与 CI 通过分别报告。
