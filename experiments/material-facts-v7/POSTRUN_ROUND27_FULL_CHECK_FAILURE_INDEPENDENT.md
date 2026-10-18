# ROUND27：v20 独立产物核对通过，完整整合检查失败

本回执状态为 **ARTIFACT_AUDIT_PASS_FULL_INTEGRATION_FAIL_APPLICATION_BLOCKED_NEW_REVIEW**。产物核对通过不抵消完整检查失败；另有主侧新报告的 7 个审查问题，本回执尚未独立逐项分诊，应用不能写成最终验收通过。

我按主侧授权，在 ROOT 原样运行一次 `npm exec --yes --package=node@24 -- npm run check`，没有另跑五门禁，没有更改并发或重试。实际 Node v24.22.0，2026-10-18 13:07:43.967–13:26:41.923 UTC，共 1137.956 秒，**exit 1**。Vitest 为 46 文件/1789 通过；材料测试 67 通过、1 平台跳过；Python 三套 9/11/16 通过。最终运行时为 **6862 tests = 6811 通过 + 50 失败 + 1 跳过**。50 个失败报告条目中，32 个是叶测试，18 个是失败父组，不能称有 50 个独立产品缺陷。

完整日志中的 v20 门禁四子项依次为：79 文件绑定通过 40.41ms；76 历史文件还原及 callback 异常清理通过 28735.80ms；当前 manifest 等价空白的真实 CLI 负测失败 896404.82ms；只改金额 guard 注释的真实 CLI 负测通过 128940.15ms。父组失败，因此按既有“五项含父组”计数为 **3P/2F**。失败的 manifest 负测实际 stderr 是历史共享绝对预算耗尽，未到达预期 `Correction v20 manifest bytes changed`，不能将任意 exit 1 算作正确拒绝。

其余失败主要在历史 v8–19 CLI 门禁以及 v4–7；还包括旧 v2 的 60000ms 夹具负测（实际约 60019.96ms，stderr 为空），以及生命周期测试 `stdout and stderr pause independently...`。后者预期成功 code0，却在约 6480.65ms 得到 null；该夹具自身 6000ms、SIGKILL，日志指标断言尚未到达，不能据此断言 backpressure 逻辑本身已经坏掉。明确的源代码位置和 32 个叶失败索引见 failure-log-review.final JSON。

运行期间一次只读机器观察有 386 个 Node 进程、合计约 29.8GiB RSS；该数是全机聚合，不能证明全属本检查。未观察到明确 OOM 或磁盘耗尽。并发压力是待隔离的假设，不是已确认单一根因。原始失败不得被后续单跑或降并发结果覆盖。

另行轻量复算没有导入原 scorer 或运行历史子进程：固定每层 43 金标，12 案×3后端×6层共 **216 个保存匹配分区**，TP/FP/FN/F1 及原候选/金标覆盖重新核算通过；79 current、76 archive、原始 60 文件和全部历史 manifest 字节一致。v20 manifest 为 `6bddae4eb7d7da1fd744a79a399620e8fa60e7c5fe79d1ef7aaf8a072b491a87`。rules 报告逐字同 v19；Qwen 10 处、DeepSeek 13 处仅 normalization.reason 从通用概数说明改为内嵌“多/余”说明，其他字段、六层匹配、计数和 production defense 关联均未变。

46 个 accepted 金额为 21 exact、23 approximate、2 unsupported，全部仍有 source_relation_unresolved；无无警告精确金额，无计算授权。accepted、派生 amount 和可用计算事实是不同结论，以上不构成法律或人工验收。全部 320 个保护路径在完整检查前后字节完全相同。

应用 b4974a3 的远端 CI run39129728847 成功及 222 场景 HTTP 是主侧另行提供证据，我没有执行该 HTTP 或独立向远端查询。请求模型为 GPT-6.1 Sol/ultra，实际 backend 配置不能独立核验。本回执未新增模型请求、未改产品或冻结结果、未提交推送。
