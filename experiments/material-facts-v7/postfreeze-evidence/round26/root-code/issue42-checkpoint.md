当前状态：PR #45 的 ec8dc649f3857771003eeafe0d87df1645635ded 完整检查及[精确CI39125905377](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39125905377)已通过，同190项隔离HTTP旧185通过5失败→190通过，原始输出和中间失败保留。随后审查新增5项，其中比较符号≤/≥等错误精确金额为P1，另有金额标签后的不确定性、后置按单位费率、繁体无金额描述和纯币种值。正在第26轮固定ec8复现、修复并独立核对；当前不建议合并。

实验v18已经另存，manifest67cfc9e3746d5de87492bebe903da1d773fa39e50da056978104b0b8a32c99aa，主侧write/check及独立73current/70archive/216匹配分区/原60和真实5门禁通过。状态为ARTIFACT_PASS_APPLICATION_BLOCKED，实验最终整合全检/远端CI仍待。v18保持不变，修复后将另存v19；没有新的模型调用或标签改写。

正式模型首轮仍为12留出案/43参考事实，7份官方页面中2页跨开发/留出案件，标签为非专家暂定参考。最新六层分数与v17相同，仅Qwen一条804.60年假金额恢复精确解析，主体/期间关联警告仍在。Qwen资产变价/法院收款误作工资实收、DeepSeek工程劳务款误作完整工资等业务错误仍在。46条接受金额全部有关联待核警告，不能视为自动可用事实。

Issue #42保持打开。[PR #45](https://github.com/ZZZZihan/anxin-work-rights/pull/45)负责工程修复，[PR #46](https://github.com/ZZZZihan/anxin-work-rights/pull/46)保存实验与证据；后者远端尚为旧检查点，最终核对后继续推送。本轮未合并、未训练、未部署生产；技术验证与人工业务验收分开。
