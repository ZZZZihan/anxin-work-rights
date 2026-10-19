固定60ac605ab28a1b2e4f9a179d841c632b91343136的R44汇总发布修复。

同一11项作者测试：旧版Node24为6通过5失败；修后Node24.22.0和Node26.11.0各11通过、0失败、0跳过。五个失败断言涉及同一原子发布合同，不能称五个独立产品漏洞。真实旧CLI在原生RLIMIT_FSIZE=512下留下512字节非法comparison.json；再次发布因EEXIST退出1，原坏文件字节未变。修后故障仅留下512字节stage，正式目标不存在，解锁后重试发布完整比较并保留原失败stage。

只改summarize.mjs的发布调用，复用已有publishImmutableFile；buildSummary及聚合辅助实现与精确旧版逐字相同。原summary共用锁保持。已有目标、目录、symlink、dangling symlink拒绝且目录清单不变；完整链接前有锁且正式名不存在；并发summary受同锁拒绝；发布后清理失败保持exit0/原stdout并在stderr明确published warning。

测试复制真实summarize/freeze(v7/v6)/lock/publisher五个模块进入自有微型树，合成三组12-case报告及回执。只运行真实summary CLI与原生文件系统；未调用评分器、历史CLI、模型、网络或完整项目检查，不使用真实标签/原输出作破坏测试。保留全部原始日志、fixture、失败stage和源快照。此为作者测试，不是人工业务验收。

当前入口有限只读审计：assess:203/207和verify:270已调用同publisher；freeze:278–280先wx stage写/sync/close后link；corrective-assessment-v33:46与旧版本源码通过publishArtifacts:30/37先写独立stage目录再rename发布。固定60ac受审当前入口未见另一个直接wx写正式report/comparison/result-manifest的遗漏。剩余直接写如run:104/133/134/284处于独占attempt的运行/失败记录，owner写与freeze failure receipt属控制/诊断文件；历史verify wrappers仅写自有还原树，不能把这些统称全部I/O已经原子。旧历史snapshot不修改，本审计未执行其CLI。静态扫描完整清单另附。

剩余边界：不保证硬件断电/目录fsync；SIGKILL可能保留stage及共用锁，按原手工对账策略处理；真实I/O失败stage有意保留；未知权限/跨设备故障未全面枚举。模型仅请求gpt-6.1-sol/ultra，实际后端未独立核验。
