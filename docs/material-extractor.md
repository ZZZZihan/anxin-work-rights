# 本机材料识别伴随服务

服务只处理应用后端转交的材料原件字节，不接收客户端提供的文件路径、来源 URL 或模型名，不调用远程模型，不下载模型。原件仍由应用 Worker/R2 保存；伴随服务只使用私有临时目录，完成或失败后删除临时原件与 PDF 渲染页。任务结果保留在内存 15 分钟；服务重启后需从应用保存的原件重新发起。

## 启动及协议

```js
import { randomBytes } from 'node:crypto';
import { createMaterialService } from '../scripts/material-service.mjs';

const token = randomBytes(40).toString('hex'); // 调用方保存于私有配置，不打印、不写仓库。
const service = await createMaterialService({ token, port: 0, model: null });
// service.url 是 http://127.0.0.1:<随机端口>。退出时 await service.close()。
```

也可从命令行启动，使用机器私有环境中的 `ANXIN_MATERIAL_TOKEN`、可选 `ANXIN_MATERIAL_PORT` 与 `ANXIN_VISION_MODEL`。未指定模型时只运行 OCR 和明确的字段文字规则。启动调用方可选择本机已安装且 Ollama capabilities 包含 `vision` 的模型，或特殊值 `apple-foundation-models` 使用 Apple 本机文字模型。服务启动只查询可用状态和编译本机 helper，不产生推理。模型配置无效时 health 显示错误，识别任务明确失败，不自动降级成规则结果。

```sh
node scripts/material-service.mjs
```

所有路由都要求 `Authorization: Bearer <token>`；浏览器 Origin 请求被拒绝，不提供 CORS。服务始终只监听 `127.0.0.1`。

| 方法 | 路径 | 请求与响应 |
| --- | --- | --- |
| GET | `/health` | 非敏感引擎能力、模型元数据/配置错误、限制；不返回材料或 token |
| POST | `/jobs` | 原始文件 bytes，Content-Type 与 `x-document-kind`；202 `{jobId}` |
| GET | `/jobs/:id` | `{status:'running'}` 或 `{status:'ready',result}` 或 `{status:'failed',error:{code,message}}` |
| DELETE | `/jobs/:id` | 200 `{ok:true}`；清除缓存结果/等待任务，取消正在执行的 OCR/模型并清理私有临时材料。未知 ID 也返回 200，支持幂等重试；临时清理失败明确 503 `TEMP_CLEANUP_FAILED`，支持再次删除重试 |

Content-Type 支持 `image/png`、`image/jpeg`、`application/pdf`、`text/plain`。材料类型仅 `contract/wage_statement/chat/other`。单份原件最多 10MB，PDF 最多 5 页；超限明确失败，不静默截断。最多一个执行任务和两个等待/正在接收的任务，已完成内存缓存最多 32 项，队满 429。HTTP 请求体接收超时 15 秒；OCR 和编译各最多 60 秒，视觉模型最多 120 秒，Apple 文字模型最多 60 秒。结果完成后 15 分钟失效，失效或服务重启后 GET 返回 404 `JOB_NOT_FOUND`，应用应从保留原件重新提交。DELETE 可立即释放完成结果或排队原件，并等待正在执行的任务中止及临时文件清理；关闭服务同样中止所有任务并清理专用临时目录。

临时目录清理失败时不会发布成功结果；任务返回 `TEMP_CLEANUP_FAILED`，health 的 `cleanup.pending` 显示非敏感待清理数量。队列仍会处理后续任务，取消和关闭不会因未终结的 job.done 挂住。系统每 30 秒重试待清理目录，DELETE 也会重试该任务目录；关闭服务清理整个服务专用目录，失败则明确报错。监听端口占用时，同样撤销新建的私有目录。文件系统持续拒绝清理属于待处理故障，不能声称原件已经从伴随服务清除。

macOS 图片使用 Apple Vision accurate 中文/英文识别，PDF 由 PDFKit 渲染全部允许页后逐页做 OCR。非 macOS 当前只支持 UTF-8 TXT，图片/PDF 返回 `OCR_UNAVAILABLE`；未实现 Linux OCR，不应把本机结果称为 Debian 部署结果。Word 仍可由主应用保存，伴随服务返回 415；识别尚不支持 Word。

## 结果与出处

```json
{
  "engine": {"ocr":"apple_vision","structuring":"ocr_rules","model":null,"modelDigest":null,"imageCount":1},
  "pageCount": 1,
  "blocks": [{"id":"p1-b1","page":1,"text":"月工资：8000元","bbox":[0.03,0.2,0.5,0.05],"confidence":0.95}],
  "fields": [{"key":"wage_standard","label":"工资约定","value":"8000元","quote":"月工资：8000元","blockIds":["p1-b1"],"origin":"rule"}],
  "warnings": ["字段由 OCR 与明确文字规则提取，未调用视觉模型；请对照原件核对。"]
}
```

`bbox=[x,y,w,h]` 使用归一化左上角坐标；图片宽高比例由应用原件提供。TXT 没有图像位置，bbox/confidence 为 null。规则结果的 imageCount 记录 OCR 页图数量，视觉模型结果记录实际提供给模型的图像数，Apple 文字模型始终为 0；TXT 为 0，模型结果同时明确警告本件只输入文字，不能称为该件已做视觉推理。modelDigest 绑定实际安装模型的 digest，规则结果为 null。OCR 置信度描述文字识别，不能解释为事实、真伪、法律适用或胜诉概率。空 OCR、损坏材料、加密 PDF、超过 5 页、超过 32000 字或 1000 OCR 块都明确失败。

字段键只允许 `employer/worker/job/employment_start/employment_end/wage_standard/payment_date/payment_amount/arrears_statement/management_statement`。value 必须是 quote 的逐字子串；quote 必须逐字存在于所有引用 blockIds 的 OCR 原文。模型虚构 block、改写金额/日期、添加无关引用、输出法律结论会被拒绝并计入 warnings。候选字段至多 40 条，必须由用户对照原件核对；服务不计算欠薪合计、不确认劳动关系、不覆盖应用已确认字段。

模型若把展示元数据 `[已引用且确实存在的blockId] ` 加在 quote 开头，服务仅移除这一个已知前缀，并仍要求去除后的 quote 逐字存在于所有引用 OCR 块、value 逐字存在于 quote。未知编号、错误引用或改写文字均不会通过该格式修正；规则不会填补模型字段。warnings 只记录拒绝数量与格式/引用问题类型，不返回未获支持的候选内容。

逐字引用检查之后另有保守的字段含义拒绝约束：岗位需岗位/职位/职务/工种等上下文；入离职与付款日期须包含实际月日并具有对应事件上下文，聊天时间与工资月份不是付款日期；工资标准和付款金额须是金额文字并紧邻相应金额标签，排除工资所属月份和把另一项金额错配到该 key；工作管理陈述须实际包含上班、考勤、打卡、排班、到岗等安排内容。免责声明和单独文档标题不能成为事实候选，用人单位不能仅是“公司”等泛称。欠薪陈述须在 value 本身明确表达拖欠或未发工资，单独付款承诺不成为工作安排。拒绝项以“原文不支持该字段含义”计入 warnings，不改 value/quote，也不会由规则补出模型遗漏项。这些有限约束用于拒绝已知误分类，并不证明任意材料语义识别准确，可能保守遗漏；仍须逐项人工核对。

指定 vision 模型后，实际图片与带 ID 的 OCR 原文发送到固定的本机 Ollama `127.0.0.1:11434/api/chat`，所有 Ollama 请求拒绝 HTTP 重定向，避免材料转送其他地址。开启 JSON schema 格式，`num_ctx=4096/num_predict=768/temperature=0/think=false/keep_alive=0`。OCR 原文超过本次模型上下文预算返回 `MODEL_CONTEXT_LIMIT`，图片/渲染页合计超过 20MB 返回 `IMAGE_CONTEXT_LIMIT`，模型超时或无效 JSON 明确失败。模型资料不具有工具调用权限。结果 `structuring=local_vision_model` 表明实际调用视觉模型；`origin=model` 只用于实际模型返回并通过出处校验的字段。模型可返回空数组或所有候选均被拒绝，此时 fields 为空，不能把调用完成称为取得有效字段。

`apple-foundation-models` 使用 `SystemLanguageModel.default` 与 SDK 原生运行时 `GenerationSchema`，只接收 kind 和带 ID 的 OCR 文字，不接收图片，也不使用 Private Cloud Compute。系统已有框架，无需下载。运行时 schema 限制字段键和最多 40 个字段；后端仍逐字验证 quote/blockIds/value。此机 CommandLineTools 缺少 FoundationModelsMacros，故采用运行时 schema 替代 `@Generable` 宏，不安装新工具链。结果 `structuring=local_text_model`、`model=apple-foundation-models`、`imageCount=0`；warnings 明确由 OCR 负责视觉识别、文字模型仅见识别文字。系统模型未暴露可核验的版本 digest，因此 modelDigest 为 null。不可用、拒答、超时或生成错误明确失败。

## 应用集成和恢复要求

Worker 必须先按用户检查案件与材料归属，从 R2 读取已上传且未删除的原件，并核对 content_hash；不要把伴随服务直接暴露给浏览器。Worker/D1 保存幂等分析任务，按材料 ID、hash、分析版本及模型 digest 区分结果。采用 202 和轮询，避免公开网关 60 秒超时；GET job 返回 404 后可以对保留原件重新提交。

删除或取消时，Worker 应调用 DELETE 清除服务任务；离线服务无法确认清理时必须标记待清理，服务恢复后再次 DELETE 并确认成功，或确认服务关闭时私有临时目录已清理成功。内存结果 TTL 到期只证明缓存结果失效，不证明磁盘临时原件已删除；文件系统清理持续失败时不得把 TTL 或关闭意图当成已清理证据。材料 hash 或案件状态变化时，最终结果保存前重新检查 D1 归属和状态，丢弃晚到结果，防止已删除材料分析复活。OCR/模型失败只影响分析状态，不能改变原件上传状态。数据库检索与法条引用由主应用负责，伴随服务只返回材料原文和字段出处。

## 验证与合成样例

```sh
node --test scripts/material-service.test.mjs
swift fixtures/material-demo/generate.swift fixtures/material-demo
```

单元/HTTP 测试覆盖所有路由鉴权、浏览器来源拒绝、客户端模型/URL 拒绝、输入边界、UTF-8 与规则实际提取、逐字字段引用、队列容量、运行/等待任务删除及重启丢失。macOS 测试额外运行真实 Apple Vision PNG/PDF OCR，核对合成合同、到账记录与聊天的预设文字、bbox、损坏图片和 6 页 PDF 失败。注入故障测试验证重定向拒绝、清理失败后的错误/取消/后续任务恢复、占用端口后的清理；这些故障测试没有发出真实模型推理请求。

`fixtures/material-demo` 中所有文件均为明确标识的合成材料，不能用于说明真实当事人材料已经验证。视觉模型推理不属于默认测试；主 Agent 授权后才可单图、单并发运行已有模型的有限探针，并记录模型名、返回引擎、耗时、内存情况及字段出处。不要把 OCR/规则测试通过写成 VLM 已验证。

2026-10-13 本机实测：13 项 Node/HTTP 测试全部通过，其中包含真实 Apple Vision 三类合成 PNG 与 PDF OCR。唯一一次 `qwen3.8-uncensored:27b` 合成合同图片探针在 6.076 秒触发预设内存停止条件（系统内存压力由正常 1 升至警告 2，空闲比例降至 32%，该探针基线期间 swap 未增加），随即关闭服务并中止请求；Ollama 最终没有加载模型。该探针未取得模型字段结果，不能称为 VLM 实跑成功；启用 27B 模型前须重新评估内存条件。

Apple 本机文字模型首次合成合同服务试验耗时 8.123 秒，内存压力保持正常 1，空闲比例 59%→57%，swap 不变；生成的 6 个候选全部被严格引用校验拒绝。唯一追加诊断在相同合成合同 OCR 文字上耗时 4.635 秒，压力仍为 1，空闲比例 60%→57%，swap 不变。诊断保留了 5 个真实生成候选，发现 quote 全部误带 `[p1-bX] ` 展示前缀；修复前 0 项通过，去已知装饰前缀后重放 5 项通过严格引用和值检查。这是既有模型输出的重放验证，并非修复后的新推理或最终应用 HTTP 验收。原始诊断仅保存在本机私有临时报告中；最终整合版本的实际 Apple 模式 HTTP 验收由主 Agent 负责。

主 Agent 随后的真实 Apple HTTP 调用完成上传、OCR、AI、出处和检索链路，但审读发现语义误标：合同声明被当成工作安排，工资标题被当成岗位，工资月份被当成工资标准/付款日期，泛称公司被当成单位名称，付款承诺被当成工作安排。旧实际报告保留为修复前负例。新增重放测试验证该轮三类 PNG 的 20 个已返回候选中，9 个已知误标被拒绝，原有 11 个有对应上下文的候选保留，value/quote 不改，不补缺失的欠薪字段；另有金额错配、未付款、聊天时间、日期上下文等正负测试和 HTTP warnings 测试。prompt/schema 改为通用字段含义，没有嵌入验收材料的完整原句。重放不能代替修复后实际推理；最终新候选的真实 Apple HTTP 验收仍由主 Agent 执行。

语义守卫候选的后续真实 Apple HTTP 验收保留了合同 5 个、工资记录 4 个正确字段，聊天保留劳动者及两条欠薪陈述，但遗漏已有原文支持的工作安排，故加强验收仍为 FAIL。最后一次提示增量要求逐 OCR 块独立审查工作/考勤安排与工资状态，两个类别可并存，陈述字段保留完整原文上下文；没有修改语义守卫或降低 HTTP 验收要求。该提示的编译和非推理测试通过并不证明漏项已修复；主 Agent 对最终候选最多再做一次实际模型验收，若仍遗漏则保留模型受限结论，不反复调到通过。
