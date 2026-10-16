# 欠薪与劳动关系确认：公开资料数据库样例 v1

这是一份可离线查询、可追溯到官方原文的开发样例。收录 33 个官方公开案例、8 部法规的全文来源以及其中 54 条相关条文，覆盖欠薪和劳动关系确认两个主题。提供 SQLite、JSONL、原始网页快照、清洗文本和标准库构建工具，无需付费 API、数据库账号或 Python 第三方依赖。

**开始使用：[release/labor-public.sqlite](release/labor-public.sqlite)**。数据包中的案例来自官方典型案例汇编及指导性案例公开材料，不能称为 33 份完整案卷；没有取得案件的证据原件。加工标注经过自动校验及 Agent 交叉技术复核，尚未经法律专业人员核读。

## 直接查询

在仓库或解压后的数据包根目录运行（Python 3.10 及以上，CI 使用 3.12）：

```sh
python3 -B scripts/public-data.py stats
python3 -B scripts/public-data.py search 举证 --topic wage_arrears --kind cases
python3 -B scripts/public-data.py search 平台 --topic employment_relationship --kind cases
python3 -B scripts/public-data.py search 劳动报酬 --kind provisions
python3 -B scripts/public-data.py get case-spc-2024-wage-employer-burden
```

`search` 按空格切分关键词，要求每个词都命中，再按标题和正文匹配次数排序；中文短语可直接输入。返回 ID、出处和摘录，`get ID` 返回记录及引用段落。该工具是关键词检索基线，没有调用向量模型、大模型或自动法律判断。不能把它的命中结果称为语义 RAG 效果。

也可直接使用任意支持 SQLite 的程序，或 Python 内置 `sqlite3`：

```python
import sqlite3
from pathlib import Path

path = Path("data/labor-public-v1/release/labor-public.sqlite").resolve()
with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
    rows = db.execute("""
        SELECT c.id, c.title, s.url
        FROM cases c JOIN case_topics t ON t.case_id=c.id
        JOIN sources s ON s.id=c.source_id
        WHERE t.topic=?
    """, ("wage_arrears",)).fetchall()
    for row in rows:
        print(row)
```

`examples/query.sql` 提供案例到材料、法规和出处的连接查询。`release/*.jsonl` 每行一个 JSON 对象，适合导入后端、标注工具或后续检索索引；`provisions.jsonl` 的每条条文同时携带所属法规、版本和适用范围字段。

## 内容与来源

| 类别 | 内容 | 边界 |
| --- | --- | --- |
| 案例 | 33 例；欠薪 23 例、劳动关系确认 13 例，其中 3 例同时属于两主题 | 平台司机、骑手、家政、主播、混同用工、海外欠薪、工程工资、工资支付与举证等；包含劳动关系不成立案例 |
| 法规 | 劳动法、劳动合同法、劳动争议调解仲裁法、确立劳动关系通知、工资支付暂行规定、保障农民工工资支付条例、劳动争议司法解释（一）（二） | 保存指定发布版本；未做全国地方规则穷尽性检索 |
| 条文 | 54 条完整选定条文 | 法规来源保留全文，检索表只索引选定条文 |
| 材料 | 38 项案例原文提及的材料描述 | `has_original=false`；没有合同照片、聊天截图、音频、银行流水等原件 |
| 引用 | 案例原文明确提及的 33 条规则引用 | 已收录法规按正式名称关联；未收录规则保留名称和原文引用，不伪造目标 |

14 个来源页面均通过公开 HTTP 免费获取；采集时间、准确 URL、发布机构、网页日期和 SHA-256 均在 `curation/*/sources.json` 以及 `release/sources.jsonl`。网页日期、文件公布日期和法规版本施行日期分开保存。典型案例未披露的裁判地区、裁判日期一律为 `null`，不拿转载地或发布日期代替。

案例来源包括最高法 2024 年 1 月、12 月欠薪典型案例，2025 年 8 月劳动争议典型案例，以及南阳市人社局公开转载的人社部、最高法第三批劳动人事争议典型案例。本次另补最高法指导性案例237—240号及第四批劳动争议典型案例中的孕期工资差额案。法规逐项来源见生成的 [来源清单](SOURCES.md)。

免费访问不等于开放许可。本样例没有给来源网页另授开放许可；源站权利信息保留在 `usage_note`。采集未登录、未付费、未绕过访问限制；不使用搜索摘要拼接全文。准备公开再分发或模型训练时，应按具体材料及用途另核查授权范围。候选中明确限制页面转载的济南法院页面已替换为最高法正式发布页，没有包含该候选页面快照。

## 版本、引用与标注的含义

- `facts` 区分原文事实转述、当事人主张与明确认定；裁判/仲裁结果放入 `outcome`，案例分析放入 `reasoning`。没有原文明示争点的案例用空 `issues` 和 `issue_disclosure` 标明，不把标题改写成裁判争点。
- 每个实质内容字段有段落 `refs`；段落属于该案例正文范围。案例内容字段采用原文摘录，分类、标签和选取属于加工标注。`get` 会展开引用原文，方便核读。
- `cited_rules.link_basis=source_explicit` 仅说明案例原文明确提到了这个规则名称。非空 `law_id` 是名称级关联，**不确认所收录版本就是案件应适用的版本**；所有 `version_match=not_determined`，并随记录保存 `link_note`。
- 劳动法 2018 版和劳动合同法 2012 版来源未单独核实修正决定的施行日，`effective_on=null`；末条记载的原法施行日保留在 `original_effective_on`，不混用为修订版本施行日。
- 2020 年司法解释（一）保存历史公布全文。2025 年司法解释（二）第二十一条明确废止前者第三十二条第一款；本版没有选取该已废止款作为检索条文。具体变更与适用限制随 `status_note` 保存，不能把 `expires_on=null` 理解为已经确认整部现行有效。
- 所有记录 `annotation_status=agent_curated_not_legal_expert_reviewed`。没有补造案号、判决日期、法院地域、原始证据或模型置信分数。

## 重建与核查

```sh
# 从冻结原文离线重新提取并比对，不访问网络
python3 -B data/labor-public-v1/curation/cases/collect_sources.py --verify-clean
python3 -B data/labor-public-v1/curation/laws/collect.py --verify-clean

# 重新构建发布文件；build 中也强制运行离线来源校验
python3 -B scripts/public-data.py build
python3 -B scripts/public-data.py verify
python3 -B -m unittest discover -s scripts/tests -p test_public_data.py
```

`verify` 检查原始快照哈希、从 HTML 到段落的重新提取、案例摘录与记录范围、法规完整选条文本、版本字段、外键及 SQLite 完整性，并独立重建数据库比对所有逻辑表和结构，逐项比对全部 JSONL。构建的 `manifest.json` 记录数据指纹与发布文件哈希，`quality-report.json` 记录自动检查结果和限制。语义技术复核与应用检查见 [VALIDATION.md](VALIDATION.md)，两者不替代法律专业审核。

默认只使用冻结快照。各 collector 的 `--fetch` 才访问原站；变化内容不得直接套用旧段落编号，需重新冻结、核读、构建。来源失败记录只证明当次尝试，不能据此断言网站长期不可用。

`--data-dir PATH` 和 `--out PATH` 必须放在子命令前。`--data-dir` 只用于本样例的**可信副本**：构建/验证会执行其中的本地提取器，不可指向陌生下载包或未经检查的 Python 代码。输出非空目录必须有本数据集 manifest；输入未通过验证不会覆盖原发布文件。多文件写入若被中断，先运行 `verify`，失败后重新 `build`，不要使用未通过核查的混合文件。

## 多模态方向如何接上

本版先提供证据材料类型、原文引用和争点/规则结构，方便后续把合同照片、聊天截图、流水或录音的识别结果连接到可追溯的资料；**尚未实现或验证 OCR、视觉模型、ASR、跨材料事实融合、主动补证或自动法律适用**。

`examples/multimodal-intake.template.json` 是无真实当事人内容的空白接入模板：为图片保留页码/区域坐标，为音频保留时间段/说话人；事实记录连接到具体来源片段，另存人工核对状态，冲突信息单列。该模板不是案件证据、训练样本或模型实验结果。

后续可在取得合规、明确授权的真实材料后比较“纯文本输入”和“多模态材料输入”，评价金额/时间/主体提取准确率、跨材料冲突检出、引用定位准确率、无依据输出和补证建议。必须以同组案件拆分训练/评估，并使用 `case_group_id` 防止同案跨集合泄漏；目前 33 例的规模和典型案例抽样不能支持准确率或胜诉率结论。

应用索引由 `npm run data:runtime:build` 生成，已连接项目的公开资料检索与材料引用链路。本次扩充的部署状态以对应 PR 和验证记录为准。

案例程序阶段与适用限制见 [coverage.json](curation/cases/coverage.json)，并随运行索引的 `versionNote` 返回：21 例包含实体裁判/仲裁叙述；另 12 例为执行、破产、调解或协商等过程，不可用作劳动关系/工资责任实体结论监督。`merits_supervision_eligible=true` 仅表示原文含此类叙述，不代表已完成训练授权或法律专业审核。

检索任务、冻结规则与初始成绩见 [评测集说明](../labor-eval-v1/README.md)和[基线报告](../labor-eval-v1/baseline.md)。题集为 Agent 根据公开原文编写，未使用真实用户提问。
