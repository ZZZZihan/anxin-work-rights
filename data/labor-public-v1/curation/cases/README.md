# 官方公开劳动争议案例样例

本目录保存 4 个官方完整案例汇编页面及 14 个可追溯案例记录。主题标签计数为欠薪 8 例、劳动关系确认 8 例，其中 2 例同时涉及两种主题；不是 16 个独立案件。每条 `case_group_id` 对应一个原始案例，不按诉讼阶段或主题重复拆成多个样本。

## 来源与采集边界

- 最高人民法院，2025-08-01：[最高法发布劳动争议典型案例](https://www.court.gov.cn/zixun/xiangqing/472681.html)。选择关联企业混同用工案例。
- 最高人民法院，2024-12-23：[依法惩治欠薪！最高人民法院发布涉欠薪纠纷典型案例](https://www.court.gov.cn/zixun/xiangqing/450661.html)。选择海外务工欠薪、工资支付预期违约案例。
- 最高人民法院，2024-01-25：[最高法 人社部 全总发布涉欠薪纠纷典型案例](https://www.court.gov.cn/zixun/xiangqing/423922.html)。选择工程联合体清偿、挂靠清偿、工资支付方式、工资举证责任、监察调查证据案例。
- 南阳市人力资源和社会保障局，2023-06-09：[人力资源社会保障部 最高人民法院关于联合发布第三批劳动人事争议典型案例的通知](https://rensheju.nanyang.gov.cn/2023/06-09/135971.html)。全文转载通知签署日期为 2023-04-24；来源网页发布日期为 2023-06-09。选择其中全部 6 个劳动关系确认案例，含成立与不成立结果。

全部来源为无需登录、免费访问的政府或法院官网，均使用直接 HTTP GET；未使用搜索摘要拼接全文，也未使用 Jina 代理。`raw/*.html` 为未经改写的响应体字节，`.http.json` 保存实际采集时间、响应状态、最终 URL、内容类型及响应边界；传输层不是司法文书真实性认证。原网页未声明开放数据许可，免费访问不等于任意再分发授权。原始来源和使用说明随数据保留。

`clean` 包含原网页标题、发布时刻字段以及完整文章容器正文。采集脚本针对法院页的 `div#zoom` 和南阳人社页的 `div#mainCon` 提取正文，只移除导航、脚本、样式、空块和多余空白，保留段落顺序。每条 `sources.json.paragraphs` 具有稳定顺序 ID；`clean` 严格等于这些段落以两个换行连接并在末尾增加一个换行。

## 标注边界

所有结构化叙述均从对应段落精确截取，`curate_cases.py` 保存字段选择与分类规则。`facts` 的 `reported_fact` 表示典型案例叙述，`claims` 的 `party_assertion` 表示当事人请求或抗辩，`adjudicated_fact` 仅提取原文明示的法院或仲裁事实认定；违约、合同关系、清偿责任等法律判断和“有理由相信”等推理归入 `reasoning`，不作事实监督。原文中的“案例分析”“典型意义”也归入 `reasoning`，不冒充完整裁判文书。完整裁判/仲裁结果只保留于 `outcome`，不复制到 `facts`。6 个第三批案例原文明示“争议焦点”，`issue_disclosure=reported_in_source`；8 个最高法案例没有明确争点表述，`issues=[]` 且 `issue_disclosure=not_explicit_in_source`，不以宣传标题、裁判要旨或治理目标代替争点。

14 个案例均未披露具体裁判日期或案件裁判地区，因此 `decision_date` 与 `region` 全部为 null。海外案的“老挝”作为原文明示的务工地点保留在事实中，不用于推断裁判地区。劳动关系成立期间、入职日期、工伤日期或来源发布日期均不替代裁判日期。

原文提及的 22 项材料均未取得公开原始附件，全部 `has_original=false`。`mentioned` 只表示原文提到；`accepted` 仅用于明确被法院/仲裁作为认定依据的考勤记录、情况说明、监察调查笔录；`not_disclosed` 用于原文明示未提供的工资台账和清单。不凭岗位或案由补写银行流水、聊天截图、考勤表等材料。没有明确材料描述的案例使用空数组。

`cited_rules` 只记录该案例正文中明确引用的规则。引用可能出现在案例分析或典型意义中，其上下文由 `refs` 保留；并非这些规则全部出现在原裁判的法条依据清单中。仅当该名称与已收录法规正式名称完全相同、且唯一匹配时设置 `law_id`；否则为 null。每条关联均保留 `version_match=not_determined`，名称关联不判断案例适用版本。`annotation_status` 始终为 `agent_curated_not_legal_expert_reviewed`；技术校验不等同律师审核或人工专业审核。

## 重建与验证

从仓库根目录运行：

```sh
# 离线、只读：用已保存原始 HTML 重新提取并比较来源/段落/clean
python3 data/labor-public-v1/curation/cases/collect_sources.py --verify-clean

# 离线重建来源与clean（不联网）
python3 data/labor-public-v1/curation/cases/collect_sources.py

# 离线重建案例字段和对当前法规样例的唯一名称关联
python3 data/labor-public-v1/curation/cases/curate_cases.py

# 检查最终JSON的来源、字段与精确出处
python3 data/labor-public-v1/curation/cases/validate_cases.py

# 离线模拟响应，验证冻结快照保护；临时夹具检查后自动清理
python3 -O data/labor-public-v1/curation/cases/verify_fetch_guard.py

# 显式联网比较：既有快照响应变动时拒绝覆盖；相同时保留原元数据和时间
# 仅当原始快照不存在时保存新响应与实际采集时间
python3 data/labor-public-v1/curation/cases/collect_sources.py --fetch
```

初版实际验证：4 个来源的保存字节哈希、离线正文提取及 clean 一致；14 个案例的必需字段、同源 refs、112 个精确原文字段、22 项材料标志及 19 条规则名称/条款出处均通过脚本校验。112 个原文字段包括 22 项事实（其中 5 项为明确事实认定）、21 项当事人主张、6 项明示争点、27 项分析、22 项材料描述和 14 项结果；规则引用单独验证。最终法规链接与应用工具整合需要由主流程再验收。

`verify_fetch_guard.py` 不联网、不改交付快照，在本目录的临时夹具内验证变动响应拒绝覆盖、相同响应保留所有字节及时间、缺失快照保存新响应三条路径。检查使用显式异常，不依赖可能被 `python -O` 跳过的 `assert`。
