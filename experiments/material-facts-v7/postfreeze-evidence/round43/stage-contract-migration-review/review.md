这三处旧 stage 合同迁移在限定范围内合理，没有发现削弱真实 I/O 失败诊断的改动。

与固定 b199f52154d0eab731cb7d562ca02cff53021fe8 逐字比较：R41 仅把完整 EEXIST 竞争失败方 stage 数从 1 改为 0；assessment、result-manifest 各仅修改对应并发标题及 losing-stage 断言。唯一成功、另一方 EEXIST、winner 完整字节/JSON、既存目标及符号链接安全断言均保留。

保留失败 stage 的要求适用于真实写入、同步、关闭故障。assessment 的原生 EFBIG/128 字节截断、重试后故障 stage 原字节不变，以及成功发布后的清理告警测试未改。result-manifest 对 EFBIG、sync EIO、write+close 双错误、发布成功后的 unlink 告警及符号链接的断言未改。共享 helper 只在完整 stage 已 write/sync/close 后的 link EEXIST 清理自有 stage；清理失败仍抛原 EEXIST，并明确附带 cleanup code/path，不伪称零副作用。

首轮完整检查真实失败与旧测试 snapshot 均已读取并固定 hash：3860.472597 秒、exit 1，目标断言为实际 0 对旧预期 1。第二轮完整检查仍由主代理执行，本收据不预记其通过。ROOT 既有 52 项聚焦检查与非实现者两运行时 3 项碰撞收据仅作为已有证据核对；本次没有运行测试或 CLI。

三个旧并发测试本身是自然竞争，不能单独证明两方都先写完；真正 link-loser 路径另由已存在的 R43 barrier 作者测试和非实现者 native-link 屏障测试覆盖。本次审阅者是 publisher 与两个旧作者测试的原作者，未实施 ROOT 的这三处迁移；这是合同一致性复核，不把整套实现称为独立自证，也不是人工业务验收。
