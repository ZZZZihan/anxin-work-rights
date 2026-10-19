# ROUND42 assessment CLI 输出保护独立复核

MONEY 最终 `assess.mjs` **5d96722e5d6ec46ed5b8218c769d934b6ad5af390a2b830ced8624d6ff7aa3d7** 在本次有限范围未发现阻塞。只替换该入口的 OWN 隔离树、沿用 ROOT 精确 78 个 lib 文件与 R41 发布 helper；本结果不是 ROOT 整合检查、CI 或材料复评分。

独立锁定脚本 SHA **b54ef91abd33ba58d40fb4e8c8cd22d2c8005d0dac9bb37ee465d2f5d138f16b**，同一真实 CLI 测试执行结果：

|执行树与运行时|实际退出|通过|失败|跳过|
|---|---:|---:|---:|---:|
|ROOT 当前旧入口副本，Node24.22.0|1|1|4|0|
|最终入口副本，Node24.22.0|0|5|0|0|
|最终入口副本，Node26.11.0|0|5|0|0|

五项依次验证已存在报告、已存在输出符号链接、新文件完成且二次发布拒绝、无效输入不产生输出、两个实际 CLI 并发只允许一个成功。旧入口会覆盖 sentinel 报告和符号链接目标，仍以 0 退出并打印报告；并发两次也都报告成功。最终入口拒绝覆盖，保留既有目标原字节；两个 CLI 只有一个完整 winner，另一项实际 EEXIST、非超时或 signal 退出。新的空报告六层零计数完整，stdout 与其 summary 一致。

本次仅使用三个空 JSONL 合成输入，输出都在 OWN 临时目录，不读取原材料进行重新评分，也没有触碰 ROOT 原冻结报告。152 个指定源/结果路径在测试前后摘要完全相同；精确列表已保留，不能扩大为全仓文件均独立核查。父 Agent 后续授权整合不属于这个保护快照的时间范围。基线与最终隔离执行树的输入依赖也未变化，重现源保存在 `baseline-execution-source.tar.gz`，最终仅叠加 `assess.mjs.final.snapshot`。

静态差异仅删除未用 writeFile 导入，CLI 内动态引入既有 `publishImmutableFile` 并报告临时 stage 清理失败。非 CLI 导出函数主体在删除该 import 后逐字一致，评分函数和事件/金额策略没有本次改动。helper SHA **2dad271198a54cdebb47b43a4d8dde720a6bfccb4dfda8139fb2581916f2f084** 与 R41 原字节一致。这里证明完整文件发布和不替换，不声称断电持久性。

旧 P1 来源确认为 **PullRequestReview.body**：[5561620840](https://github.com/ZZZZihan/anxin-work-rights/pull/46#pullrequestreview-5561620840)，commit `3e14bd781a230b3fc937fd6e46a62b8b87232bab`，提交于 `2026-10-18T05:41:34Z`，GraphQL ID `PRR_kwDOVApLyM8AAAABS3-ZaA`。其正文提出既有冻结 report 会被 writeFile 覆盖；`0abcea` 快照仍包含相同写入入口。本次未修改或关闭 GitHub 审查。审查线程和普通 issue comments 的统计不能代替 review 正文检查，也不能凭线程已解决称全部 finding 消失。

原 baseline 四项真实失败全部保留。首次 Node26 launcher 错写不存在的 `/usr/local/bin/node`，在启动测试前即 FileNotFoundError；更正到实际 `/opt/homebrew/bin/node` 后执行同锁五项。初始回执生成还误要求两份不同快照的 no-index diff 检查返回 0；实际返回 1、无空白错误诊断，已如实保存并取消该错误工具断言。两项工具错误都不是产品红测。脚本语法检查实际退出 0。

未执行历史 CLI、全套检查、HTTP、模型、训练、部署或 GitHub 写入；ROOT/v31 与既有收据对本 Agent 保持只读。请求配置 GPT-6.1 Sol / ultra，实际服务 backend 未独立核验。完整机器回执 `round42-assessment-publication.independent.json`，原始 stdout/stderr、每次 CLI 退出与目标快照见白名单。
