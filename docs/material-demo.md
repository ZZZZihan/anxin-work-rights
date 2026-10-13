# 材料识别与公开出处样例

本样例把合同、工资到账记录、聊天截图中的文字和候选事实，接到欠薪与劳动关系确认公开资料库。原文件、原始提取值、用户修订、典型案例和法条各自保留来源。它用于整理材料和查询资料，不判断真伪、劳动关系是否成立或案件结果。

## 启动与操作

需要 Node.js 22.13+、Python 3.10+。图片和 PDF 识别支持 macOS 与 Linux：macOS 使用 Swift 命令行工具及 Apple Vision/PDFKit，首次运行会在私有临时目录编译助手；Linux 使用本机 Tesseract、`chi_sim` 简体中文语言包及 Poppler 的 `pdfinfo`/`pdftoppm`，启动前需安装并配置这些工具，服务不会自行下载。其他平台可用 UTF-8 TXT 演示文本链路。依赖与私有安装路径见[提取服务说明](material-extractor.md)。

```bash
npm ci
npm run dev:materials
```

打开 `http://127.0.0.1:3013`：

1. 创建一个演示案件，进入「证据管家」。
2. 上传 `fixtures/material-demo/contract.png`、`wage-statement.png` 或 `chat.png`。这些文件显著标注为合成材料，不是真实合同、银行记录或聊天证据。也可上传扫描版 `contract.pdf`。
3. 选择「劳动合同」「工资流水」「聊天记录」对应的识别类型，点击「识别并检索」。文件名和上传类别会提供初始类型，可在开始前修改。
4. 对照原图与文字，检查单位、劳动者、工资、日期等候选字段。「定位原文」会标记图片文字区域；PDF 展示页码和原文行，下载原件后核对。
5. 修改字段后重新勾选「已与原文件核对」，保存。原始提取值和摘录不会被用户修订覆盖。关闭后再次打开或刷新，保存结果仍在。
6. 展开相关典型案例和法条，查看完整引用段落、官方来源链接、发布日期/采集时间及版本说明。

支持 PNG/JPEG、PDF 和 UTF-8 TXT。单文件不超过 10 MB、PDF 不超过 5 页、识别文字不超过 32000 字。Word 可归档和下载，需转为 PDF/图片才能识别。低清晰度、遮挡、印章、表格关系或聊天上下文都可能导致遗漏，需要人工核对。

## 实际处理方式

默认启动使用本机 OCR 和可解释字段规则，界面标为「OCR + 规则提取」：macOS 使用 Apple Vision，Linux 使用 Tesseract `chi_sim`，PDF 由 Poppler 按 216 DPI 逐页渲染。缺少对应工具时图片或 PDF 识别明确失败，UTF-8 TXT 仍可处理。这条路径不调用大模型。检索采用有限劳动权益词表、同义词及加权匹配，不是向量语义检索，也不生成法律结论。

可通过环境变量显式选择已有本地模型，启动器不会下载模型或调用付费服务：

```bash
# 支持 Apple Intelligence 且系统模型可用的本机：OCR 后交给文本模型整理
ANXIN_MATERIAL_MODEL=apple-foundation-models npm run dev:materials

# 仅用于已安装、具备 vision 能力且资源足够的 Ollama 模型
ANXIN_MATERIAL_MODEL=<本机模型名> npm run dev:materials
```

文本模型模式标为「文字识别 + 本地文本模型」；图像仍由 OCR 读取。Ollama 视觉模式会提交实际页面图片和 OCR 文本，并记录模型名及摘要。显式选择模型失败时显示失败，需用户重试，不悄悄替换为规则结果。具体实现、可用条件及实际验证结果见 [提取服务说明](material-extractor.md) 和 [验证记录](validation/README.md)。

切换模型配置只作用于新任务；已保存结果保留当时的引擎信息和人工核对内容。比较不同模式时，请重新上传合成样例，避免覆盖已有核对结果。

## 出处与数据边界

公开索引固定为首版数据库的 14 个典型案例和 54 条条文，涉及 8 份规范文件、12 个官方来源；数据库 fingerprint 为 `e599f7f44e0350378c8369a0bf98932ffb15c111bd7d2d867402584104d8ad7a`。每个命中都能追到源段落和 URL。案例属于官方典型案例汇编，不能当作已取得原始裁判文书。版本说明沿用采集库，未核实的现行性不会标成「现行有效」。

模型仅提交候选字段。服务端要求每个提取值都出现在引用片段中，片段必须对应同页的真实 OCR 文本行；不符合者丢弃并告知。另对日期、金额、岗位、管理安排等字段作保守的上下文检查，拒绝将月份工资误当付款日期、将标题或声明误当岗位/管理信息的候选。它只过滤模型输出，不用规则补出「模型字段」。这些检查不能保证 OCR 或字段语义全部正确，也可能漏掉不同表述，仍需人工核对。人工更正可以不同于 OCR，但明确标为用户修订。案例和法条从冻结索引重新检索，绝不接受模型自造引用。

检索仅使用识别出的劳动权益概念，展示的查询词不含材料姓名、公司名、账号或任意自由文本。完整材料仍只存在用户所属的文件、分析记录及本地处理过程。

## 保存、失败与恢复

原文件由已有 R2 链路保存，分析状态和核对修订保存在 D1。分析前核验原文件 SHA-256。其他用户不能读取、开始、修改或删除分析。修订有版本检查，冲突会提示先保留编辑内容再加载最新版本。

识别服务仅监听 `127.0.0.1`，不允许浏览器直接访问，不接收任意远端 URL。`npm run dev:materials` 为当次开发启动生成临时令牌；合成 HTTP 的部署启动器从 synthetic root 中的私有 `material-service.json` 读取地址与令牌，分别配置应用 Worker 和材料伴随服务。该令牌由运维生成并受控轮换，不因伴随服务重启而自动改变。部署配置与启动方式见[合成 HTTP 部署说明](../deploy/synthetic-http/README.md)。

临时文件处理后清除，内存任务缓存有 15 分钟到期时间。删除材料会先持久化取消并删除分析，再请求处理服务取消/清理任务；晚到结果不能恢复已删除数据。若处理服务不可用或临时目录清理失败，界面会说明临时材料尚未确认清理，应用原文件删除仍完成。目录清理失败会每 30 秒重试，关闭服务也会重试；持续失败需在本机处理，不能把内存 TTL 当成磁盘清理成功。案件归档只隐藏工作内容，不等于删除材料或数据。

上传成功而识别失败时，原文件仍可下载。恢复服务、确认格式后点击「重试识别并检索」。任务过期、模型不可用、超出页数或无可读文字都会显示可解释错误。重启开发服务后，已保存分析可读取；尚未完成的内存任务需要重试。默认 `npm run dev` 没有启用处理服务，页面会显示未配置。

整合版已实现同一 Debian 主机上的隔离 Worker 与回环材料伴随服务接线，使用 Linux OCR 与规则；伴随服务不向外部网络开放，也不启用 Ollama 或 Apple 文字模型。本次合成 HTTP 部署沿用已有数据 root 升级，部署及实际网站验收已完成，实际候选、运行检查与恢复结果以[本次发布验证记录](validation/material-live-20261013/README.md)为准。Cloudflare 云端 Worker 的回环地址属于另一运行环境，不能直接使用该主机的 `127.0.0.1`；云端接入仍需单独设计可达地址、身份与数据处理边界。

## 重建与核查

```bash
npm run check
# check 包含索引来源核查及平台服务测试；macOS 使用 Apple Vision，Linux 使用 Tesseract/Poppler

node scripts/material-http-runner.mjs
# 隔离生产构建 D1/R2，实际 TXT HTTP 闭环

ANXIN_MATERIAL_REPORT=output/materials/http-images.json node scripts/material-http-runner.mjs --images
# macOS：三类图片和扫描 PDF 的 Apple Vision HTTP 闭环

ANXIN_MATERIAL_REPORT=output/materials/http-linux-images.json node scripts/material-http-runner.mjs --images --punctuation-equivalence
# Linux：同一组合成材料的 Tesseract/Poppler HTTP 闭环；需先准备 chi_sim 与 Poppler
```

真实 OCR 测试在相应受支持平台运行，缺少 Linux OCR 依赖时会明确跳过，不能把跳过计为识别通过。`--punctuation-equivalence` 仅允许合成夹具预设事实比较中的已定义中英文标点等价；OCR 原文、字段引用和出处校验不变。

HTTP 回归在一次性状态目录运行，结束自动清理。不要把回归脚本指向真实用户环境。模型模式的实际验证应独立记录，不能用规则模式的通过结果替代。已有 macOS 与模型验证记录保留在[验证目录](validation/README.md)，本次 Linux 整合与部署验收另行记录。
