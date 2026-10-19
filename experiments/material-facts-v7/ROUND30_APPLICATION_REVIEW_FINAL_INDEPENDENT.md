ROUND30 四项应用问题的最终独立复核已完成。在本次限定范围内未发现剩余阻塞；这不代表任意中文金额、法律事实或人工业务验收已经通过。

精确旧基线为 `47e4c30545b4fc1af27e716c030ea9e583728938`。本复核未参与三份产品实现，只新增独立测试与证据；请求配置为 GPT-6.1 Sol / ultra，实际后端配置无法独立核验。

我在实际 CODE 工作树运行四个锁定脚本，共 31 个测试：Node v24.19.0 与 v26.11.0 均为 31 PASS、0 FAIL、exit0。两次运行各记录了 80 个 lib/assess/package 路径的前后摘要，全部相同。原始 value/quote/raw_output、representation 与 Unicode 码点位置的保留、历史精确值只能降级且旧 null/unsupported 不自动升级、同额不同源文事件在六层评分中不能借分，均有实际断言。accepted 与可用金额分别核对，测试中的无计算授权标志不能证明真实业务流程获得了人工确认。

原 25 项脚本在精确旧基线的两个 Node 上均实际为 8 PASS / 17 FAIL；4 项全角裁剪保护控制在旧版已全部通过。另锁定的有限续文测试含五个直接同族输入，旧版与初版修复均失败；付款指示后问号测试则是旧版通过、初版新增能力后退化、最终恢复，不能把这个中间回归计作原始缺陷。全部原始失败日志和中间字节均保留。最终 31 项来自 25+4+1+1，五个逻辑续文输入归在一个测试中，不另当五份材料。

最终审核字节为：money `b3047474600bd08e829c53c6ca0914c87d3f152df4322fba196477b80c70dd46`；arithmetic `460e412fa75fc9879c5b1973290ee8c2232eb0408b8f7fcc6d539e399e367e03`；range `7dafb86e05c78fef64e815ecd6ec9439573a9099692b67f0ec8eb7951b0d24aa`。source 保持旧基线 `4a6c88c1663c3b02b7166013d502c32f1fa37778d020b7f4a09617069f5cd3f5`。完整全角数字只在原 token 锚定后的解析副本折叠；显式运算后半成/半折/对折及负数附注返回不可用，不执行算式或生成负金额。有限付款指示豁免要求完整货币单位和同一右边界，完整 source layout 中的问号不能被局部 quote 丢掉。

我还只读审查了六份旧测试的全部变更：13 个完整有效全角金额移为 exact 正例，角分顺序、角分多位数、重复单位、缩放单位、外币、算式、相邻尾数和裁剪防护没有删除。named-subunits 另有一处尾空格清理，已独立重建核对它仅相差一个空格。父侧旧 688 项的 675 PASS / 13 FAIL 到迁移后 688 PASS 属于父侧执行证据，我未重复运行该套件。

父侧证据另列：309 定向测试通过；应用完整检查 exit0，其中 fact-runtime 为 7562 PASS、1 SKIP；同一 HTTP310 夹具为旧基线 281 PASS / 29 FAIL、最终 310 PASS，311 份原始输出相同，重启保留 309 份 raw/history 快照，cleanup PASS。我只读核对了相应收据和日志摘要，不把这些执行归为本人的 HTTP 或完整检查，也不将原始快照保留夸大为重启后二次金额派生全验收。

最终机器收据为 `round30-application-review.final.independent.json`。可复制索引在作者树 `postfreeze-evidence/round30/round30-final-independent-handoff.json`，明确将该作者证据目录映射到主树 `experiments/material-facts-v7/postfreeze-evidence/round30/`。旧冻结结果、旧回执、旧日志均未改动；本次没有推理、训练、部署、提交或推送。
