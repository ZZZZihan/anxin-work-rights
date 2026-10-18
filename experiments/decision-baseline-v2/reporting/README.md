# 冻结后离线审查与配对汇总

这两个脚本只读取冻结数据、四臂推理产物和独立审查结论，不加载模型、不训练、不请求网络、不修改冻结评分。独立审查者是 Agent，不是人类专家；72 条输入由 Agent 合成，不是真实案件，36 组也不能解释为 72 个独立现实样本。

`prepare_review.py` 生成匿名审查包，`summarize.py` 核验、拼接审查并复现汇总。二者使用 Python 标准库和仓库已有的冻结本地评分/算术代码，不需要推理环境、MLX 或 API 密钥。

## 正式运行

在 `experiments/decision-baseline-v2` 目录执行。四臂全部完成且均已生成 `assessment.json` 后，统一混合一次打包：

```sh
python3 reporting/prepare_review.py \
  --run-dir results/test-qwen-v1 \
  --run-dir results/test-qwen-v2 \
  --run-dir results/test-deepseek-v1 \
  --run-dir results/test-deepseek-v2 \
  --batch batch1 --output-dir review
```

输出 `review/blind-batch1.jsonl` 和私有 `review/blind-batch1-mapping.json`。只把前者交给独立审查者；映射中包含臂、原始 ID、私有随机种子和原始目录，不得向盲审者提供。审查者按下文格式交付 `review/semantic-batch1.json`。脚本不会自动生成正式审查答案。

问句、业务金标、输入会话和可信工具状态可见，backend/variant、原始 ID、分组、类别和未归一的协议外壳不可见。`review_id` 和混合顺序由保密随机种子生成。归一只移动动作外壳、去掉由冻结评分负责的 metadata；每个 `questions[].field` 和 `text` 保留原值，不改写、补写或删改问句。无法可靠解析、重复 JSON 键、多动作壳、非有限数字或指数溢出时，完整原文保存在 `unparsed_output`，不修复金额或替换建议。

选择范围是每臂中“金标为 ask_user、实际包含 questions、或冻结 canonical 错误”的并集。程序终止旁路也按同样规则处理，不能因此得到模型成功计数。输入/标签必须逐字节匹配 freeze；协议的完整根目录 Python 来源、v1 依赖和对应版本 prompt 哈希必须匹配 freeze；评分案例和聚合必须与未修改的冻结 scorer 重算完全一致。

所有审查交齐后生成新汇总：

```sh
python3 reporting/summarize.py --output comparison.json
python3 reporting/summarize.py --check
```

`--output` 只创建新文件，已有文件一律拒绝覆盖。`--check` 不写文件，在内存重现后逐字节比较当前 v2 根目录的 `comparison.json`；可传 `--check path/to/report.json` 指定其他位置。`--root` 指定另一份完整 checkout 的 v2 目录，默认使用脚本所在 v2 目录，不依赖当前工作目录。

脚本支持多批：未交叠的完整臂可分别使用 `batch1`、`batch2`；同一臂同一案例跨批重复一律失败。实际实验采用四臂统一混合一次。`--seed` 只用于在另一个空目录按原私有种子重现包，不能交给审查者；同名批次不可覆盖。汇总要求四臂均有显式映射清单、全部应审条目有且只有一次结论，包、映射、审查或运行产物被更改都会失败。

## 独立审查 JSON

每个 `semantic-batchN.json` 使用如下结构；`packet_sha256` 是对应 `blind-batchN.jsonl` 整文件 SHA256，`cases` 必须一一覆盖包中所有 `review_id`。下面仅说明 schema，不是实际结论。

```json
{
  "schema_version": "anxin-semantic-review-v1",
  "batch": "batch1",
  "packet_sha256": "对应匿名包的64位SHA256",
  "reviewer": {
    "kind": "independent_agent",
    "human_expert": false,
    "model_requested": "gpt-6.1-sol",
    "reasoning_effort_requested": "ultra"
  },
  "cases": [
    {
      "review_id": "匿名包中的review_id",
      "business_action_correct": true,
      "question_text_adequate": true,
      "rationale": "结合当前输入说明业务动作与问句为何适当；错误时指出具体未决事实。"
    }
  ]
}
```

字段要求：

- `business_action_correct` 必须是布尔值，核查下一步动作、问题字段和工具参数是否符合当前事实。检查业务含义；原协议格式、missing/conflicts/reason 等 metadata 的合规性由冻结 scorer 单独负责。不能把用户希望、金额偏好或随意选择当作已经核实的事实。
- `question_text_adequate` 为布尔值或 `null`。金标要求问句或输出实际包含问句时，必须显式判断原文是否追问真正未知/冲突的事实，是否完整、明确、有助于解决当前阻塞。冲突应核对来源并核实事实，不能让用户按偏好选一个金额或日期。已知事实不应无故重问。字段标签正确本身不代表问题语义正确。只有不涉及问题语义时才用 `null`；原文未解析但能辨认问句时也应作文本判断。
- `transport_error=true`（请求错误或结果缺失）固定为 action `false`、question `null`，不替模型编造建议。
- `rationale` 是非空具体理由。每条仅允许这四个键；审查文档仅允许示例中的五个顶层键。reviewer 配置字段表达请求的配置，不宣称能独立核验运行时的实际配置。

审查者只读匿名包，不读私有映射、四臂结果目录或汇总成绩，也不改写原问题。作者/实现者不能代独立审查者生成正式 semantic 文件。汇总保留审查对业务动作的否定，且同时报告它与冻结动作诊断的分歧数。

## 预先固定的汇总口径

每臂分别报告全部 72 条、非终止 64 条、可信状态耗尽的终止 8 条。四个指标并列：

| 指标 | 固定定义 |
|---|---|
| `canonical` | 冻结 `canonical_correct`，原样包含其执行检查 |
| `system_action_question_semantic` | 冻结 `system_action_fields_correct`，且独立审查业务动作通过、问题语义不为 false |
| `model_raw_semantic` | 冻结 `raw_action_fields_correct`，且上述业务/问题语义通过；只有真实程序旁路记 null/NA，未返回结果记 false |
| `executable_canonical_question_semantic` | 冻结 `canonical_correct`，且上述业务/问题语义通过 |

只有冻结 canonical 正确且不涉及问句的条目可免独立审查，语义部分由冻结的事实字段/参数检查承担；所有应审但未审条目会阻止汇总。v1 的工具执行口径是冻结本地算术重放，v2 是本地 dispatcher，均不表示真实业务系统集成。

`planned_denominator` 保留 72/64/8；`applicable_denominator` 只排除 null，原始模型语义另列真实模型调用分母/正确率，JSON/协议接受率也只用真实调用分母。程序旁路不计模型成功；结果缺失和请求错误继续占计划分母，缺失结果也作为 false 参与配对，不变成不可比较。

每 backend 配对比较同一输入的 v2 与 v1，列出 new_wins、old_wins、ties（均对/均错）和不可比较数。组指标要求原始两条都在当前 cohort 且两条都通过，单条组明确排除。全部 cohort 有 36 完整组；状态对照分拆到非终止或终止 cohort 后，不把单条组冒充完整组。raw 中含程序旁路的比较会列为不可比较。

模型延迟只统计真实调用，明确排除加载和旁路；实际调用数、请求错误和没有 latency/usage 的次数保留。Qwen 同时报告 MLX 分配器峰值和宿主内存/交换区观测，前者不等于进程 RSS，后者不能全部归因于该模型。DeepSeek usage 与返回模型/指纹按原记录汇总，费用使用并绑定 `verification/pricing.json` 的已核验峰时 input cache-miss $1.32/M、cache-hit $0.044/M、output $3.96/M，非峰时估算乘 0.5。账单与失败请求收费未知，不能称为实付；没有可用 usage 的请求明确计为未估价。

汇总不包含当前生成时间或当前机器目录。私有 mapping 中的原绝对 `run_dir` 只作审计 metadata，文件定位使用当前 root 下的逻辑 arm `results/test-{backend}-{variant}` 和内容哈希。原运行的时间、内存和模型来源记录仍属稳定原始产物。报告绑定源码、数据、运行产物、审查文件和价格文件哈希；同一组文件在 Linux CI 可离线逐字节重现。

## 离线自检

```sh
python3 reporting/summarize.py --self-test
```

自检在自动清理的临时目录创建 72 条虚构输入、36 组、四臂本地产物，并用冻结 scorer 和确定性算术生成夹具分数。它完全不读真实模型结果、不调用模型或网络，也不生成正式审查包。检查包括原问题逐字保留、非有限/歧义 raw 回退、64 调用与 8 旁路、请求错误与缺失结果、metadata 和业务语义分开、坏问句的可执行指标失败、成本计算、多批完整拼接、重复/缺失审查及哈希篡改拒绝、排他写入，以及迁移绝对目录后逐字节重现。夹具的 semantic 结论是测试数据，不是正式独立审查。
