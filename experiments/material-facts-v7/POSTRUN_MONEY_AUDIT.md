# v7 正式首跑金额与生产守护：实现者自检

这是金额解析实现者的首跑后自检，与非实现者独立技术复核、数据作者复查和用户业务验收分开。审阅对象为已终止的 rules、DeepSeek、Qwen 各 12 案正式首跑，全部 54 个原始 money 候选、其中 46 个 accepted money 候选，以及全部 23 条冻结 money 标签。本文没有修改冻结来源、标签、原始输出、既有分数或首跑前证据，没有重新调用模型或重新生成报告。

**结论：本批实际 accepted 金额中，未发现把概数转成精确数、把未知转成零、把错误数值或外币换成人民币的实例；这不等于金额管线已达到业务安全验收。** 模型仍有把库存变价/法院缴款当工人工资付款、把工程款当工资累计、把付款人当享有方、把裁命金额当个人完整应付额的实际语义错误。46 项 accepted money 全部保留复核 issue，守护没有自动纠正这些语义。还发现两类实际可用性损失：温州全额支付被邻近“单笔”语句误警，谷某裁命金额仅少末尾“整”即被降级为 null。

正式首跑之后另有已确认的重复人民币标记区间端点缺口：原冻结解析器会将“人民币3万元至人民币4万元”裁剪出的一个端点变成精确金额。该缺口不出现在这 12 案实际金额输出中，但足以阻止依据本批结果宣布范围裁剪已全面安全。后续修复及测试属于另一份首跑后变更证据；本文只记录边界，不使用修复后源码重算本轮分数。

## 证据范围与索引

本文 C[n] 一律指相应 results.jsonl 中原始回答 candidates[n]，从 0 开始；A[n] 指拒收后 accepted 索引。DeepSeek、rules 无拒收，C 与 A 相同；Qwen 有拒收，下面明确写出需要转换的索引。b01 等是输入原文块。位置为现有报告的 Unicode 码点半开区间，不是本文重新锚定或重评分的结果。

三路 outcome.completed 均为 true，报告均为 planned/returned/completed/protocol_valid = 12/12/12/12；全部 finish_reason=stop。Qwen 12 案原始回答均带外层 JSON fence，native_json=0，但生产协议支持该格式，不能算 12 个协议失败。DeepSeek native_json=11，另一案同样通过 fence 协议解析。Qwen 63 个全部候选中 accepted 51、rejected 12；其中 money 为 raw 29、accepted 21、rejected 8。DeepSeek money 23/23，rules money 2/2。

本次只读重算了结果 manifest 中全部 60 个文件哈希，60/60 吻合。冻结代码的 32 份 .snapshot 逐份匹配 frozen-code/manifest.json；这 32 份快照与剩余冻结文件合起来，124/124 可恢复文件匹配原 freeze.json。核验的是首跑代码可恢复性，不声称后续工作树源码仍与原 freeze 完全相同。

| 路线 | 原始 money | accepted money | exact | approximate/null | unsupported/null | accepted 带复核 issue | 无 issue 的精确 money |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rules | 2 | 2 | 2 | 0 | 0 | 2 | 0 |
| DeepSeek | 23 | 23 | 10 | 13 | 0 | 23 | 0 |
| Qwen | 29 | 21 | 8 | 10 | 3 | 21 | 0 |
| 合计 | 54 | 46 | 20 | 23 | 3 | 46 | 0 |

上述 exact 是金额数值规范化状态，不能推导金额含义、受益主体、工资期间或完整性正确。全部 46 项都带 source_relation_unresolved；额外的 partial_*、scope_text_mismatch、source_amount_context_mismatch 见下文。没有 accepted 的 amount=0.00，也没有把未知改成零。Qwen 被拒的 8 项 money 仍保留在原始输出，并计入 raw 评分。

为方便复查，以下只按既有报告的 pairs/extra/missing 列表筛出 money 项聚合 TP/FP/FN，没有重新匹配、重建报告或新增替代分数：

| 路线 | raw basic | accepted basic | raw relational | accepted relational | raw strict | accepted strict |
| --- | --- | --- | --- | --- | --- | --- |
| rules | 2 / 0 / 21 | 2 / 0 / 21 | 0 / 2 / 23 | 0 / 2 / 23 | 0 / 2 / 23 | 0 / 2 / 23 |
| DeepSeek | 20 / 3 / 3 | 20 / 3 / 3 | 13 / 10 / 10 | 13 / 10 / 10 | 13 / 10 / 10 | 13 / 10 / 10 |
| Qwen | 10 / 19 / 13 | 10 / 11 / 13 | 4 / 25 / 19 | 4 / 17 / 19 | 3 / 26 / 20 | 3 / 18 / 20 |

这些数的 expected 范围为 23 条金额，不是包含日期的全部 43 条事实；不能与报告整体 F1 混用。

## rules：全部两个实际金额

| 案例、候选 | 原文与守护金额 | 自检判读 |
| --- | --- | --- |
| mf7-bjchy-2024-5103 C[0] | b01，16000元 → 16000.00；rate/month | 数值、月费率正确；subject=null、scope/assertion=unknown，漏掉黄某及其主张层级。source_relation_unresolved 保留。不是个人完整应付额。 |
| mf7-bjchy-2025-10440 C[0] | b01，12000元 → 12000.00；rate/month | 数值、月费率正确；主体及主张层级不足，同样带 source_relation_unresolved。不是个人完整应付额。 |

其余 21 条金额 gold 没有规则候选。两份自然空材料也为空，但不能凭这两个空负例证明规则处理了中文裁命、工程款或同额事件。

## DeepSeek：全部 23 个实际金额

所有 23 项均 accepted；每项都有 source_relation_unresolved。下表“正确”仅就列明属性和原文语义而言，不表示已被生产确认或取得计算资格。

| 案例、候选与来源 | 守护金额及模型角色 | 自检判读 |
| --- | --- | --- |
| mf7-spc-wenzhou-62 C[0]，b01 [44,50) | 139万余元 → null/approximate；arrears，62名农民工/group | 欠薪、群体及概数正确；没有把“余”丢掉。 |
| 同案 C[1]，b02 [123,131) | 150万元执行款 → 1500000.00；other_money，null/unknown | 数值正确，是被执行人公司的执行应收款。模型漏了公司/organization，但没有把它当工资已付。 |
| 同案 C[2]，b03 [31,37) | 139万余元 → null/approximate；paid_total/complete，62名农民工/group | 原文“全额发放”支持实际全额支付，事件与 C[0] 欠薪分开。partial_paid_total 为邻近语句污染导致的守护误警，详见后文。 |
| mf7-spc-suqian-petfood C[0]，b01 [69,74) | 38万余元 → null/approximate；arrears，邓某等51名农民工/group | 欠薪、群体、概数正确。公司无存款余额没有被误写为工资为零。 |
| 同案 C[1]，b03 [42,46) | 8万余元 → null/approximate；other_money，null/unknown | 正确区分库存变卖所得与工人实收工资；漏公司/organization。后文“顺利领取”没有金额，未补造等额工资付款。 |
| mf7-bjkfq-2025-2222 C[0]，b01 | 18619.2元 → 18619.20；other_money/claimed，谷某/individual，period=null | 数值正确；按预登记研究分类应为 arrears，且漏原文明确工资归属区间。年假诉请工资的分类仍是非专家标签边界，不能升级为法律错误结论。 |
| 同案 C[3]，b02 | 八百零四元六角整 → 804.60；award/decided，谷某/individual，period=null | 中文元角精确正确；漏了引文内明确的2023年2月7日至2024年12月2日工资期间。没有使用诉请值替代裁命值。 |
| mf7-spc-anyuan-passionfruit C[0]，b01 [76,81) | 13万余元 → null/approximate；award/decided，黄某某等31人/group | 裁命、群体、概数正确。 |
| 同案 C[1]，b02 [222,225) | 5万元 → 50000.00；payment/partial，同一群体 | 数值及部分支付正确，没有把“最终全部执行到位”推算成另一个有金额的完整已付额。 |
| mf7-spc-jilin-eleven C[0]，b01 [63,67) | 8万余元 → null/approximate；arrears/claimed，张某、赵某、关某等11位农民工/group | 原文主体是同一群体，expanded subject 与 gold“11位农民工”不等是字面评分损失；claimed 与中性 narrated 的差异另属陈述层级不符。不是找错劳动者。 |
| 同案 C[1]，b02 [54,58) | 8万余元 → null/approximate；other_money，指定上述工人群体 | 正确未标工资实付；但原文款项含案件执行费，不能将整个混合款均归工人享有，subject/group 属过度归属。与 C[0] 是两个明确事件，没有因同额混用引用。 |
| mf7-spc-kaiping-board C[0]，b01 [22,27) | 1.2亿元 → 120000000.00；other_money，null/unknown | 公司总债务数值正确，与工资87万余元分开。 |
| 同案 C[1]，b01 [135,140) | 87万余元 → null/approximate；other_money，null/group | 执行标的额按冻结分类为 award，但执行标的并非裁判主文，属于预登记非专家分类争议；另有明确“工人”主体遗漏。 |
| 同案 C[2]，b01 [341,346) | 87万余元 → null/approximate；paid_total/complete，null/group | 正确识别另一处为实际全额兑现；漏工人主体。没有借 C[1] 执行标的额的引用给实付事件得分。 |
| mf7-spp-nanchang-fan C[0]，b01 [135,142) | 1967万余元 → null/approximate；paid_total/complete，建设公司/organization | **实质语义错误**：这是转至范某某账户的劳务工程款，未证明工人已领工资；又把付款人标成享有方。应保持 other_money，而非工资完整已付。保留 partial_paid_total 与 source_relation_unresolved，语义本身未被改写。 |
| 同案 C[1]，b01 [252,257) | 100万元 → 1000000.00；other_money，建设公司/organization | 数值和非实付工资角色正确；收取商票者为范某某，模型把付款公司当享有方。商票“用于发放”不等于工人已收到工资。 |
| 同案 C[2]，b01 [420,426) | 623万余元 → null/approximate；arrears，220余名工人/group | 群体欠薪、概数正确。 |
| 同案 C[3]，b02 [34,40) | 441万余元 → null/approximate；payment/partial，欠薪工人/group | 部分垫付、群体、概数正确；没有转成完整总额。 |
| mf7-spp-ezhou-lan C[0]，b01 [101,107) | 153万余元 → null/approximate；arrears，王某、金某某等28名员工/group | 欠薪、群体、概数正确；money.period=null，没有把余额快照截至月当工资归属区间。 |
| mf7-bjchy-2024-5103 C[1]，b01 [46,52) | 16000元 → 16000.00；rate/month/claimed，黄某/individual | 数值、月费率及主张层级正确。 |
| 同案 C[6]，b02 [43,56) | 二万零四百一十三元七角九分 → 20413.79；award/decided | 中文金额、裁命、黄某及完整工资归属区间均正确；未当作已付款。 |
| mf7-bjchy-2025-10440 C[1]，b01 [33,39) | 12000元 → 12000.00；rate/month/claimed，杨某/individual | 数值、月费率及主张层级正确。 |
| 同案 C[7]，b03 [45,54) | 一万二千六百零二元 → 12602.00；award/decided | 中文金额、裁命、杨某及工资区间正确；未当作已付款。 |

金寨与高青两份自然空材料中，DeepSeek 没有金额输出，没有从“一笔资金”“全部支付”“工资专户”制造金额或零。

## Qwen：全部 29 个原始金额及 8 个拒收

| 案例、原始候选（必要时 accepted 索引） | 守护结果 | 自检判读 |
| --- | --- | --- |
| mf7-spc-wenzhou-62 C[0]，b01 [42,50) | 总计139万余元 → null/approximate；due_total/unknown，群体 | 原文是拖欠工资，模型标 due_total 而非 arrears；数值概数未升级。另有 partial_due_total 提示，不能据提示反推原文欠薪只有部分。 |
| 同案 C[1]，b02 [123,128) | 150万元 → 1500000.00；other_money，null/unknown | 数值、非工资实付角色正确；公司享有主体遗漏。 |
| 同案 C[2]，b03 [22,37) | 全额发放被拖欠工资139万余元 → null/approximate；paid_total/complete，群体 | 真实全额支付的语义正确，但 value 混入动词长串，冻结比较不视为最小金额等价，basic 失分包含 value 边界损失；另有同一 partial_paid_total 守护误警。 |
| mf7-spc-suqian-petfood C[0]，b01 [69,74) | 38万余元 → null/approximate；due_total/unknown，群体 | 应是欠薪 arrears，属于模型角色差异；概数没有变精确。 |
| 同案 C[1]，b03 [42,46) | 8万余元 → null/approximate；payment/partial，工人群体 | **实质语义错误**：库存处置价款被标成工人工资部分付款。事件位置仍为 inventory-sale，证据锚点与角色是两层，位置正确不证明角色正确。 |
| 同案 C[2]，b03 [154,159) | 剩余执行款 → null/unsupported；payment/partial，工人群体 | 原文只说股东将剩余执行款缴法院，没有金额，也未证明等额工资实收。候选保留但无数值，event 为 unregistered_position。是模型过提，不是系统造零。 |
| mf7-bjkfq-2025-2222 C[0] | **拒收**：引用不存在/不含原文值 | raw value 18619.2元 数值正确，但 quote 拼接“谷某主张未休年休假工资…”不为连续原文；due_total 分类也偏离预登记 arrears。金额未进入 accepted，不能说该诉请金额已提取成功。 |
| 同案 C[1] → A[0]，b02 [55,62) | 八百零四元六角 → null/unsupported；award/decided | 原文尾为“八百零四元六角整”，少末尾“整”被源文金额边界守护判截断，附 source_amount_context_mismatch。实际数值可确定为804.60，此为保守可用性损失；主体、裁命与工资期间正确。 |
| mf7-spc-anyuan-passionfruit C[0]，b01 [72,81) | 劳务报酬13万余元 → null/approximate；due_total/complete，群体 | 明确判决给付应为 award；劳务报酬后缀/前缀的比较损失与角色错误须分开。partial_due_total 提示来自同源另处部分先付，不能证明本裁命总额只有部分。 |
| 同案 C[1]，b02 [257,268) | 劳务工资已全部执行到位 → null/unsupported；paid_total/complete，群体 | 原文没有金额，模型过提。运行时保留不确定表达并附 partial_paid_total、source_relation_unresolved，没有据13万或5万元补一个总额，event 未登记。 |
| 同案 C[2]，b02 [222,225) | 5万元 → 50000.00；payment/partial，谢某某/individual | 数值及部分付款正确；谢某某是付款人，享有方应为31名劳动者。scope_text_mismatch 与 source_relation_unresolved 提示仍在，未自动修正主体。 |
| mf7-spc-jilin-eleven C[0]，b01 [63,67) | 8万余元 → null/approximate；arrears，null/unknown | 欠薪角色正确，原文明示11位农民工，模型漏主体与群体。 |
| 同案 C[1]，b02 [54,58) | 8万余元 → null/approximate；payment/partial，null/unknown | **实质语义错误**：工资款与执行费一起交法院，不是明确给劳动者的工资部分付款。两个同额事件的锚点确实分开，但第二事件角色仍错误。 |
| mf7-spc-kaiping-board C[0]，b01 [18,27) | 欠债高达1.2亿元 → 120000000.00；other_money | 公司总债务数值正确；较长 value 导致的字面比较限制与语义须分开。 |
| 同案 C[1] | **拒收**：引用不存在/不含原文值 | value 是执行标的额，quote 却为后段收购/工资实付叙述，且有“开平,法院”改字。没有 accepted 绑定，不能当作同额事件被成功隔离的正例。 |
| 同案 C[2] → A[1]，b01 [341,350) | 87万余元工人工资 → null/approximate；due_total/complete，null/unknown | 原文“得到全额兑现”是 paid_total/complete，模型误标 due_total；漏工人主体。仍是实付事件位置，无跨用前一执行标的额来评分。 |
| mf7-spc-jinzhai-home-textile C[0]，b01 [153,155) | **拒收**：value=工资，无金额表达 | quote“难以支付工人工资”；正确拒收无金额工资名词，raw 保留，无零。 |
| 同案 C[1]，b02 [44,46) | **拒收**：value=工资，无金额表达 | quote“拒不支付工资”；无明确金额，正确拒收。 |
| 同案 C[2]，b02 [122,124) | **拒收**：value=工资，无金额表达 | quote“会将该笔资金用于支付工资”；用途不证明金额，正确拒收。 |
| 同案 C[3]，b02 [144,146) | **拒收**：value=工资，无金额表达 | quote“工资得到全部支付”；完整支付状态也不能制造金额，正确拒收。该案另有3个 accepted 日期过提，故全案不是精确空输出，但不属于 money 漏拒。 |
| mf7-spp-nanchang-fan C[0]，b01 [132,142) | 人民币1967万余元 → null/approximate；other_money，null/unknown | 正确区分工程劳务资金与工资实际支付；漏范某某受款主体。 |
| 同案 C[1]，b01 [249,257) | 人民币100万元 → 1000000.00；other_money，null/unknown | 数值及非工资实付角色正确；漏实际收票者范某某。 |
| 同案 C[2] | **拒收**：引用不存在/不含原文值 | value 保留“人民币623万余元”，quote 却虚改成“人民币62,300,000余元”，其数字为原文623万的10倍。引文和 value 不一致、也不在源文，未进入 accepted。 |
| 同案 C[3] | **拒收**：引用不存在/不含原文值 | value 保留“人民币441万余元”，quote 虚改成“人民币44,100,000余元”，为原文441万的10倍。守护拒收，未生成精确或概数 accepted。 |
| mf7-spp-ezhou-lan C[0]，b01 [101,107) | 153万余元 → null/approximate；arrears，null/unknown | 数值概数、欠薪角色正确；漏明示工人群体，不把截至月造为金额期间。 |
| mf7-bjchy-2024-5103 C[5]，b01 [43,52) | 月工资16000元 → 16000.00；rate/month/narrated，黄某 | 月费率数值正确；原文转述黄某主张，应为 claimed。value 长度/金额比较限制不等于找错金额。 |
| 同案 C[6]，b02 [43,56) | 二万零四百一十三元七角九分 → 20413.79；due_total/complete/individual/decided | **实质语义错误**：裁命给付应为 award，不能仅凭裁命工资覆盖期就当个人完整应付累计。原值与工资期间正确，source_relation_unresolved 仍在；不是语义已被系统改回 award。 |
| mf7-bjchy-2025-10440 C[6]，b01 [30,39) | 月工资12000元 → 12000.00；rate/month/claimed，杨某 | 数值、月费率、主体、主张层级正确；较长 value 可能产生字面评分损失。 |
| 同案 C[7]，b03 [45,54) | 一万二千六百零二元 → 12602.00；due_total/complete/individual/decided | 同样将 award 误标完整应付额。数值与工资区间正确，但必须保留 source_relation_unresolved，不能声称已取得 due 计算资格。 |

高青自然空材料 Qwen 正确输出空数组，没有把工资专户文字当金额。金寨的4个 money 假候选被拒是本次真实模型输出中可观察的无金额守护证据；不代表所有描述性工资长句都会被拒，宿迁 C[2]、安远 C[1] 即仍保留为 null/unsupported 供复核。

## 同额事件、主体与标签争议的界线

温州两处139万余元是欠薪与实际发放；吉林两处8万余元是欠薪与含执行费的法院缴款；开平两处87万余元是执行标的与实际工资兑现。DeepSeek 的相关 money 均有正确事件位置；Qwen 有效候选的位置也能区分这些实际事件，开平 C[1] 的错误拼接证据另被拒。这里没有观察到仅因同额而把另一个事件位置代入得分的成功攻击；但 Qwen 吉林 C[1] 和开平 C[2] 仍有事件内部角色错误。事件对齐只是来源位置层，不能替代语义验证。

本批没有两个独立、同额、同劳动者、同金额角色、同期间的实际工资付款，故不能用该批报告验收这种情形的去重保留。真实材料中若后文只说“全部到位”，也不能从前文欠薪或资产价款补一笔同额付款。

对非专家 gold 的争议单列保留，不改本轮标签或备选：

- 吉林 DeepSeek C[0] 的 expanded subject 与“11位农民工”指同一群体；字面不匹配不应叙述成找错享有方。其 claimed/narrated 的陈述层级差异是另一件事。
- 开平“执行标的额”按预登记分类为 award；这是技术标签，不等于裁判主文。模型给 other_money 的差异需要领域复核，不能当成确定法律错误。
- 谷某年假诉请工资以 arrears/claimed 预登记；本审查只报告与合同不符和期间遗漏，不宣称解决其法律分类。
- 温州、月工资等较长 value 有时数值和事件本身正确，但不符合最小完整金额的比较语法；不能把所有 basic FP/FN 都说成数值换算错误。本文没有据此扩展 canonical 比较或补备选。
- 南昌工程款/商票享有方与工资受益方、吉林混合缴款是否全部属于工人，原文有足够区分；上文所列过度归属不是同一主体的措辞变体。

## 守护的实际收益与误警

本次可直接观察的收益包括：23 项概数持续为 null，四个“工资”无金额候选拒收，两条把万位改错10倍的南昌虚构引文拒收，以及其他非连续引用拒收。原始输出仍保留，accepted 未把这些错误金额推进成精确数。

温州 DeepSeek C[2] 与 Qwen C[2] 的局部原文明确“全额发放被拖欠工资139万余元”，但 partial_paid_total 仍出现。冻结 source-review 的邻接限定扫描会把另块“有一笔150万元执行款”的“一笔”纳入该工资候选的 qualifiers；partial 词法守护按合并上下文发警示。这是跨事件限定污染导致的实际可用性残余，不是该模型把部分付款冒称全额。原金额本来就是“余”概数，误警消除也不能直接得到精确金额。Qwen 安远 C[0] 类似受后文“先付部分款项”影响，裁命本身仍不是部分裁命。

谷某 Qwen C[1] 的“八百零四元六角”后紧接“整”，冻结 parser 把该尾字当未消费的金额边界，形成 null/unsupported 与 source_amount_context_mismatch。完整原文支持804.60，少“整”并未改变元角数量；该降级应记为保守误杀。与之相邻的 Qwen C[0] 不连续 quote 拒收则是正确的来源约束，不能把两项合为同一原因。

46/46 都有 source_relation_unresolved 也显示守护极保守：很多正确候选仍因其他原文句子存在、关系尚未闭合而被提示。这一覆盖率说明这些具体候选未处于“精确且无 issue”状态，不能据此推断警示准确率高，或模型的语义已被识别/修正。

## 计算授权证据的严格限度

报告 production_defense.calculation_authorized=false 是冻结 assess.mjs 中写死的保守报告常量，不是逐项执行真实生产确认/计算状态机得到的结果。不能把46个 false 当作46次 HTTP/用户确认流程均已验收。

静态查看首跑快照可确认：eligibleTotal 要求个人、匹配已确认劳动者与工资期间、due_total/paid_total、complete、amount 非 null 且 reviewIssues 为空；prepareCalculation 另要求完整确认状态。当前46项都带 issue，故不满足静态金额提示资格。Qwen 两个裁命误标 due_total/complete 的实例尤其说明需要这一条件。本文没有构造真实业务状态、移除 issue、调用确认或计算接口，因此结论仅为“实际报告中保留了守护障碍，且静态规则明确排除这些有 issue 的候选”。真实 HTTP 合成回归由主 Agent 的独立证据说明，不能混称本次自然材料生产验收。

## 首跑后已知区间缺口与覆盖限

PR45 review4305687517 指出原冻结 parser 对重复人民币标记的区间前后端存在缺口。隔离修复前已用4个最小输入真实复现：例如 value“人民币3万元”，quote“王甲工资人民币3万元至人民币4万元”，以及裁剪右端“人民币4万元”，会得到精确端点。中文“三万元到人民币四万元”同类。该缺口不是本批实际候选发现的错误，但属于原冻结金额安全结论的明确限制。

隔离修复使用共享的受限区间连接语法，覆盖双端重复人民币/人民幣/CNY/RMB/￥、中文/全角数字、Cf与空白检测，并保留原文/span和行边界。真实4红→290绿，扩展后 money、冻结v3、currency共535项通过；这些是首跑后合成回归，不能反算为本批首跑成功，也不能覆盖原失败。补丁与红绿证据由主 Agent 另行归档到首跑后目录，不改原 review-evidence。原冻结代码及报告仍可通过快照重建。

本批有明确数值的金额来源均为人民币精确金额或“余”概数，没有外币、负数、范围端点、遮盖、明确零等自然模型候选，因此不能用本次零观察宣称这些守护都经真实首跑覆盖。前置合成测试仍是另一层证据。来源为公开文本节选，未覆盖图片/OCR金额识别。12个holdout案件来自7份官方出版页中的一部分，共享出版源相关性不能当独立业务抽样。标签为 provisional_non_expert，不是法律专家金标准。本文也不构成人工业务批准、训练授权或生产部署授权。

## 可复查证据

以下路径均位于正式首跑树；results.jsonl 每个案例一行，行号依次为：温州1、宿迁2、谷某3、安远4、吉林5、开平6、金寨7、南昌8、鄂州9、黄某10、杨某11、高青12。详细候选索引用上文 C[n] 定位。

- [冻结清单](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/freeze.json)，SHA256 0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2；冻结时间2026-10-18T04:09:33.275Z。
- [首跑代码快照清单](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/frozen-code/manifest.json)，32份snapshot按原freeze绑定；原money.ts SHA256 04d2683bcbf4c1cb1f7056127e9ebe1eb7d9bf5f691f546ca6a12640f84375a0。
- [源文输入](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/holdout.inputs.jsonl)，SHA256 9ec54411e9008434457ae59f68585f8fb7a6bc6d089cee4e87709bfddd6a2181。
- [冻结临时标签](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/holdout.labels.provisional.jsonl)，SHA256 abac05fa2c3de7d8e83e866345bf5edaec61c65f8f706bb7d5f0c0d98fa27b64。
- [rules原始结果](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-rules-1/results.jsonl)，SHA256 c5984075bc672f2dd9a606a0add4bb61d7979ca2ca08b962dd0bfe93425b9579；[既有报告](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-rules-1/report.json)，SHA256 0553db2f6eb0801c6311021f16ce67268a165cd8198afe66fa4821ee737dbaf7。
- [DeepSeek原始结果](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-deepseek-1/results.jsonl)，SHA256 f4bee08fa7e39770deada7bc6148e26d7a9840c195fcf6221ffb25d351784621；[既有报告](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-deepseek-1/report.json)，SHA256 74e84905833c6b4b13e74e66143c1996838e4f346d0f8e13ed3e44394bc9b5a9。
- [Qwen原始结果](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-qwen-1/results.jsonl)，SHA256 b7eab68b250bf133dcccab4433913ae1ef5ddc137abf62660535c9b694efdafd；[既有报告](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-qwen-1/report.json)，SHA256 5145693b7ea3853e52ebdf511a0f36ade9192b9414525589485143cf8a0fd1ce。
- [60文件结果清单](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/result-manifest.json)，SHA256 3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee。
- [首跑评分器快照](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/frozen-code/experiments/material-facts-v7/assess.mjs.snapshot:130) 可查看 calculation_authorized 的报告常量；[生产资格规则快照](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/frozen-code/lib/material-facts-v3.ts.snapshot:321) 可查看 eligibleTotal；[源文守护快照](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/frozen-code/lib/material-fact-source-review.ts.snapshot:149) 可查看邻接限定与 partial 提示。

实现者自检完成时间以本文件交付时为准；模型请求配置沿用该子任务 GPT-6.1 Sol / ultra，不能仅凭任务文本声称核验了客户端内部实际推理配置。

