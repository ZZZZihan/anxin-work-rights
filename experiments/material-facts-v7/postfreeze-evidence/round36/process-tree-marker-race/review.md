# 进程树夹具 ready JSON 发布竞态修复

CI `39152232243` 的 fa77 原始失败已保留：runtime 8891 通过、1 失败；唯一失败是 `redirected-ignore-term` 在第 69 行读取尚未完整写入的 JSON。

本次只改 `scripts/material-facts-v7-http-process-tree.test.mjs`。叶进程先在相同目录写入 PID 专用临时文件，完整写完后再 rename 为 ready 文件；读取端只等待 ENOENT，坏 JSON、真实读取错误和提前退出不会作为 ready 重试吞掉。原 5 项整组清理、socket 释放/重绑、无关进程组保留及重复 stop 断言保持。

受控真实文件写入暂停下，旧直接发布协议同 2 项断言为 **0P/2F**；新协议在 Node24.22/macOS 上连同原 5 项和新增 4 项共 **9P/0F**，scoped ESLint 与语法检查 exit0。新增覆盖空/半份 JSON 不得可见、坏 JSON 必须报 SyntaxError、真实子进程 exit17 必须报错。前者为故障注入复现，不声称是原 Linux CI 调度的本机重演。

产品 helper 和选取的 6 份 CODE 文件 before/after hash 相同；该测试不在已发布 v26 的 97 项代码绑定中。本次未调用模型、HTTP、build、全套检查或历史链，也未提交推送。父 Agent 负责集成及后续 CI，MONEY 负责非实现者技术复核。

最终测试 SHA：`a645b80033e58b010b87bb598a6b70048d9c8f47f956a55f97bec8627d540949`
补丁 SHA：`e02c2fbbf3463bbfd36d07d3abbca9e618c5545569ca92ec680b5e23829c30ed`

此为合成夹具和局部进程生命周期证据，不是业务人工验收。完整原 CI 日志、原测试快照、同锁红与原5+新4绿日志均列在 copy-index。
