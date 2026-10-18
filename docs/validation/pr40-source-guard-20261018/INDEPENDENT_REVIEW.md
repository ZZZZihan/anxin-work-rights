# PR40 独立技术验收结果

结论：本轮最终63项独立源文回归、114项币种回归全部通过。在此次有限总额语法和同源前后原文守护范围内，未发现剩余可复现阻塞；不保证任意自然语言材料被完全理解或自动提示。

基线 f539e69c557983f8989abea38de7dabd6be0ae48：63项，9通过、54失败。
最终整合：177项，177通过、0失败。

独立63项组成：43个v3不安全输出、6个并列泛称subject在同名人工scope下、4个历史v2不安全输出、8个正向、冻结输出不变1个、独立人工已确认金额路径1个。每个不安全v3都先证明实际协议接受、未review时due提示可达，再验证reviewFactsAgainstSources -> buildFactView阻断提示，并验证raw/value/quote/representation和人工确认不改。

## 逐条源文核对（Agent 技术核对，不是用户验收）

| 风险 fixture | 原文 | baseline | final |
| --- | --- | --- | --- |
| group / comma separates the omitted group owner from the total | `['王甲班组十名工人，2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / newline separates the omitted group owner from the total | `['王甲等十名工人\n2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / group header and total occupy different blocks | `['王甲班组十名工人2024年7月工资表', '应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / parentheses and a comma crop the collective owner | `['王甲（含其他九名工人），2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / later clarification identifies the amount as a group total | `['王甲2024年7月应付工资合计80000元，实际为班组十名工人工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / later representative wording identifies joint beneficiaries | `['王甲2024年7月应付工资合计80000元，代表班组十名工人领取。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / same owner and period later clarify group representation | `['王甲2024年7月应付工资合计80000元，王甲2024年7月系代表班组领取。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / following sentence refers to the same group amount | `['王甲2024年7月应付工资合计80000元。上述金额为班组十名工人工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / preceding header explicitly makes following rows group totals | `['以下金额均为十名工人工资汇总。\n王甲2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / preceding OCR block governs an otherwise explicit personal-looking row | `['以下金额均为十名工人工资汇总。', '王甲2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / dated collective header is not another named worker event | `['全组2024年7月应付工资汇总如下。', '王甲2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| group / next OCR block refers to this same group amount | `['王甲2024年7月应付工资合计80000元。', '上述金额为班组十名工人工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject / another sentence merely mentions the claimed worker | `['王甲在甲公司2024年7月工资已经结清。李乙在甲公司2024年7月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| period / another sentence merely mentions the claimed period | `['王甲2024年6月完整应付工资80000元。王甲2024年7月尚未结算。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject and period / another block contains both claimed labels | `['王甲2024年7月的工资尚未结算。', '李乙2024年8月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject and period / one clause contains two owners, periods and values | `['王甲2024年7月完整应付工资5000元及李乙2024年8月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| period / one clause contains two amounts for the same worker | `['王甲2024年7月完整应付工资5000元而2024年8月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject / different amounts share the claimed month in one clause | `['王甲2024年7月完整应付工资5000元与李乙2024年7月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| period / current block has a different worker-month association | `['2024年7月李乙完整应付工资5000元，王甲2024年8月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject / claimed worker is only a prefix of another full name | `['王甲乙2024年7月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| period / claimed month is only a prefix of a two-month total | `['王甲2024年7月至8月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| period / claimed month is only part of an explicit date interval | `['王甲2024年7月1日至8月31日完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject / claimed worker is the speaker rather than wage beneficiary | `['王甲称李乙2024年7月完整应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| subject / named joint beneficiaries are not an individual total | `['王甲和李乙2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / partial qualifier omitted from the quote | `['王甲2024年7月部分应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / only basic salary is included | `['王甲2024年7月应付工资80000元（仅含基本工资）。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / suffix explicitly excludes overtime pay | `['王甲2024年7月应付工资80000元，不含加班工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / first installment is not the complete monthly amount | `['王甲2024年7月第一笔应付工资80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / comma separates the partial qualifier from amount | `['王甲2024年7月部分应付工资，计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / trailing wage component remains separately payable | `['王甲2024年7月应付工资合计80000元，加班工资另计。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / trailing supplementary amount is not included | `['王甲2024年7月应付工资合计80000元，另有加班工资未计入。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / same owner and month still have separately payable overtime | `['王甲2024年7月应付工资合计80000元，王甲2024年7月加班工资另计。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / following sentence refers to incomplete wage components | `['王甲2024年7月应付工资合计80000元。上述金额仅含基本工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / semicolon does not detach an explicit same-amount qualifier | `['王甲2024年7月应付工资合计80000元；上述金额不含加班工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / ASCII semicolon does not detach a same-amount qualifier | `['王甲2024年7月应付工资合计80000元;上述金额不含加班工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / preceding header explicitly excludes overtime from following amounts | `['以下金额仅含基本工资：\n王甲2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / preceding OCR block limits wage components of an explicit row | `['以下金额仅含基本工资：', '王甲2024年7月应付工资合计80000元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| due / following OCR block limits the same amount | `['王甲2024年7月应付工资合计80000元。', '上述金额仅含基本工资。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| currency / USD suffix is outside a bare-number quote | `['王甲2024年7月完整应付工资80000美元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| currency / alphabetic USD suffix is outside a bare-number quote | `['王甲2024年7月完整应付工资80000 USD。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| currency / HKD suffix is outside a bare-number quote | `['王甲2024年7月完整应付工资80000港元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| currency / parenthesized currency suffix is outside quote | `['王甲2024年7月完整应付工资80000（USD）。']` | 错误提示 80000.00 | 提示阻断，原文保留 |
| currency / JPY suffix is outside a bare-number quote | `['王甲2024年7月完整应付工资80000日元。']` | 错误提示 80000.00 | 提示阻断，原文保留 |

## 复核发现与修复轨迹

- 初版40项通过后，发现同句未知尾句4例仍穿透（实际班组/代表班组/加班另计/未计入）；已修。
- 第二轮发现同主体同期后句、句号/分号/前置header8例；已修。
- 第三轮发现跨OCR block头注/尾注4例；已修。
- 追加6个并列/泛称subject、以及带日历全组header误当另一个劳动者事件1例；已修。

## 已验证及未验证边界

- 已实际执行独立Vitest测试并检查每项结果、静态复核runtime/store调用边界、确认冻结v2/v3实现未修改。
- 有限语法会对跨句主体/期间、复杂角色、罕见含连接字姓名等更多真实材料保守要求人工核对；本轮不据此声称模型理解力提升。
- 原始JSON：independent-before.json 与 independent-after.json。
- 本子任务只修改新增独立测试文件，无实现修改、commit、push、外发评论、合并或部署。P2取消HTTP脚本仅只读审阅并通过node语法检查；实际HTTP运行与CI由root核对。
- 委派约定请求gpt-6.1-sol/ultra；仅能以创建工具请求作为配置证据，无法独立验证服务端全部实际运行参数。
