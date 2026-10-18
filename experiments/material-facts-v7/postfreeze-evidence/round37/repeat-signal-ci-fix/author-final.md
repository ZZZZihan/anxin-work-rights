# R37 重复中断测试：端口身份修复

只修改 `scripts/material-facts-http-repeat-signal.test.mjs`，SHA256 `01827620e425b5e19c3913a7ff4533d9d4f394ddefbfd8f788c1fd349ecbb7da`。不改被测 runner、进程组 helper、评分或冻结材料。

原 CI 的确失败：exact b0a9554 / run39155201166，runtime 9074 通过、1 失败；v7 migration/SIGINT 的旧端口可连接。该断言早于原组和 cleanup 的诊断，因此原 CI 的监听者身份、该场景 cleanup 结果均未知，不能把它直接定性为夹具误报或产品无泄漏。

本机 exact 原场景一次通过（不是 CI 红复现）。随后用真实子进程和内核 socket 构造确定性调度：launcher TERM 后释放端口，忽略 TERM 的子进程让清理继续约五秒，无关监听者占据旧端口。原断言稳定失败，而原组已空、cleanup PASS、重占者存活。最终同一新夹具仅还原旧裸端口断言也得到 0P1F；最终原连接身份判定则通过。此证据证明原测量协议存在误报路径，不证明原 CI 当时必然走了该路径。

修复在发信号前持有原 launcher、原后代和旁组的 TCP 连接；迁移主动失败场景先握手再 exit23。它保留原八种场景、原组清空、旁组存活、FAIL/首次信号/exit23 原因、cleanup 和私有状态删除检查，新增一项合法端口重占控制。finally 也只核自有组，不等待已可由无关进程使用的旧端口。尚活的忽略 TERM 后代在重占时必须仍有原连接且属于原组，故不会把真实存活后代当清理成功。

Node24.22 实际原8+新1 **9P0F0skip，49.116s**，九项 cleanup 全 PASS；持有 idle HTTP 连接未改变 launcher 的默认 TERM 终止行为。语法和基于项目配置的实际完整文件 lint 通过。ROOT/CODE/原基线的 12 项散列前后相同。MONEY 非实现者静审通过，并在 Node26.11 实际执行重占一项 1P0F（未重复执行原八项）。

这是合成 Wrangler/service、真实 CLI/内核行为证据；未运行应用 HTTP 验收、模型、完整检查或历史链，不是人工业务验收。Linux CI 原故障归因仍待后续证据，原失败记录保留。
