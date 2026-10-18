精确提交 b0a9554d0b7ab1a064ce490cee181d2197c31b0c 的 CI 39155201166 终态为 FAILURE，状态记为 CI_FAIL_CLEANUP_ASSERTION_APPLICATION_NOT_VALIDATED。保留本失败，不重新触发CI。

实际检出的是PR合并提交 9645b76680ba8c47c8e754da526ced8e4e68ef00，其树与头提交均为 fa3e3d044bd2d52572f0fb134682f5c99e965935，已经API、checkout原日志与本地Git对象交叉核对。

完整检查中的 Vitest 1789/46、材料68/68、Python9/11/16通过。运行时9075项为9074通过、1失败、0跳过，耗时90.338秒。唯一失败是 scripts/material-facts-http-repeat-signal.test.mjs:68 的 actual v7 CLI drains migration after SIGINT repeated during cleanup，在第138行断言launcher socket应关闭时实际仍可连接，单项9654.282ms，属于真实断言失败而非测试超时。

原诊断为CLI code1、signalnull、launcher端口true、descendant端口false、无关端口true。该断言之前未记录cleanup对象或当时PID/PGID/端口所有者，不能据此确定原launcher仍活，也不能认定仅夹具问题。后续需要定向核验进程/端口身份，不能直接删除断言或将此失败称通过。

所有后续HTTP和OCR步骤均SKIPPED。两上传步骤虽显示success，artifact API实际0项，因而没有任何HTTP/OCR产物或ZIP摘要可验；空集合的all(true)不构成产物验证。本地主侧428/428与非实现者金额77双Node通过是分开的证据，不能替换本次远端失败。

四项冻结检查步骤通过，v6原验证器与summary实际在owned临时树运行。147份原实验文件与exacthead Git blob一致，审前审后未变；14份当前产品/夹具/作者脚本也一致。原日志ZIP18成员已保存并逐项校验摘要。精确head和merge的GitHub deployment API均无记录，仅限这两SHA的API观察，未触发部署。

审查线程快照129个，仍4个未解决，IDs为4308160109、4308160112、4308160118、4308160120；isOutdated不等同于已解决。此为抓取时点，后续状态另记，不回写本记录。

本审查只读GitHub和本机材料，没有启动项目检查、HTTP、历史链、模型、重跑CI、评论或部署。本人为event补丁实现者，不将该部分自审称非实现者审查；MONEY的doubling77和HTTP证据已有独立索引。请求GPT-6.1 Sol / ultra，实际backend无法独立核验。
