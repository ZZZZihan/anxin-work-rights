# ROUND38 重占端口夹具 reset 回执

原 replacement handler 在真实 TCP 客户端收到数据后 resetAndDestroy 时，Node24 实际以未捕获 read ECONNRESET/TCP.onStreamRead 退出1。立即 reset 的另一调度为 EPIPE/exit1，原证据保留。修复仅给受控重占 listener 的 accepted socket 处理预期 ECONNRESET，其余错误仍抛出；不改 helper、runner 或生命周期期限。

原9场景可逐字还原，新增真实 reset 和非reset错误传播2项。Node24.22 实际11/11通过，原9 cleanup均通过，重占 listener/旁组仍活、原连接关闭/原组为空等断言均保留。相同 data-reset probe 修后exit0。语法/ESLint通过。MONEY另作非实现者静审并实际执行新增2项通过，不合并成其执行原11。

这是可达夹具故障的内核复现；远端 CI 当次 peer 身份未记录，因此不声称已证明整次 CI 根因。其他真实socket错误不得吞掉。未运行实际HTTP验收/build/full/历史链/模型；不改冻结或生产，配置请求Sol ultra、backend未独立核验。
