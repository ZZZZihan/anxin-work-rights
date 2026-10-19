# d963425ef 精确远端 CI 失败检查点

结论为 **CI_FAIL_SOCKET_OBSERVER_APPLICATION_BLOCKED_NEW_REVIEW**。这是一次实际失败，不能作为完整远端通过或最终应用验收。未重跑、修改产品、解决线程、部署或调用模型。

精确 head `d963425ef16831768395ba6a233df272dbaee196`，run [39156365623](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39156365623)。CI 实际 checkout `7fb6fc183cf48692d70b73d24236ad31baa2ea7a`，其 tree 与 head 均为 `85d45e2c8700a1243d3298baf0821b26a29beb76`；checkout 是包含该 head 的合并提交，源码树逐字相等。

实际计数：Vitest 46 文件 / 1789 通过；materials 68/68 通过；Python 9+11+16 通过。Node runtime 原始计数 9076 项，9075 通过、1 失败、0 skip，71300.471888ms。这是 Node 输出的计数，不另以父 suite 计数冒充独立案例数。

唯一失败是 `scripts/material-facts-http-repeat-signal.test.mjs:84` 新增第九场景，v7 migration / SIGINT / unrelated port reuse，5215.956424ms，`read ECONNRESET`，栈位于 Node TCP.onStreamRead；不是 timeout 或金额断言。原八项重复信号场景各 PASS，并有 cleanup PASS 诊断。第九项诊断记录 CLI exit1、signal=null，原 launcher/descendant socket 均关闭、owned group=[]，受控替代监听者在组外。另有 unrelated socket=false；异步错误与 teardown 先后不足以证明产品杀死无关组，也不足以证明该场景最终 cleanup 断言通过。后续断言不可补算为 PASS。

冻结步骤均通过，包括 v6 原 verifier + summary 在临时旧 v3 树执行。失败后的九个业务 HTTP/OCR 步骤全部 skipped；artifact API 返回 0 项。upload 步骤成功仅表示该 action 执行，不存在可下载的报告 ZIP，因此本次没有 HTTP428 / raw429 / restart427 / OCR 或其 cleanup PASS 证据。主侧本机 HTTP428 和完整检查另保存，不能替代此次 CI。原始 CI ZIP 已保留，SHA256 `cbbd2d4e542f47814dd543792b550c3cabcdef4a9494fe9734c026653735210d`。

147 个原始结果本机字节在审计前后不变且匹配精确 head git blobs。20 个应用/夹具文件在初始读取时匹配该 head；结束快照发现 money 文件已被下一轮授权修改，因此记录该漂移，不声称当前工作树仍为 d963。147 原结果及旧 b0 失败索引的 76 个文件全部原样保留。

远端 review 快照有 134 threads / 9 unresolved：旧 R37 四项 4308160109/112/118/120 与新 R38 五项 4308248425/432/435/438/444 分开。isOutdated 未当作 resolved；未由本 agent 回复或解决。精确 head 和 checkout SHA 的部署 API 各返回 0，这不推断所有外部部署系统状态。

只读 API、git blobs、日志与哈希核对是本次本人执行；主侧本机服务检查为主侧来源。本 agent 参与过 R37 event 实现，本报告不把其源审自称第三方独立评审。请求配置 GPT-6.1 Sol / ultra；实际 backend 不能独立核验。

`audit-failed-checkpoint.py` 初次因已有相同 snapshot 的独占写保护退出；原 stderr 保留。最终脚本先核相同字节再复用已保存项，实际 exit0；没有覆盖原日志。未运行为成功 CI 准备的两个 success-only 审计脚本。
