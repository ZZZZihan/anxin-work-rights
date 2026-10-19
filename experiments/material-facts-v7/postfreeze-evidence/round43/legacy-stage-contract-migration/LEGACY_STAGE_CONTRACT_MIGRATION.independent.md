唯一应迁移的旧断言是 `scripts/material-facts-v7-round41-failure-independent.test.mjs:65`：完整写入后因 EEXIST 输掉发布竞争的自有 stage，应按 R43 合同删除，数量从 1 改为 0。winner 字节、单一 winner、EEXIST 拒绝、已有 symlink 不跟随和不覆盖断言均保持原样。产品及冻结结果无修改。

新便携测试：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-review/scripts/material-facts-v7-round41-failure-independent.test.mjs`

- 原 SHA256：`c2dc8fe838b631e95044502a47f50f67acdfd2cfe4abfccc39166c8e28cfbd55`。
- 最终 SHA256：`e933cb7433c58c05174e60b75546181403ed32524801fbac01855afca67666d8`。
- Node 24.22.0 原脚本真实 2P1F、exit1；迁移后 3P0F、exit0。
- Node 26.11.0 迁移后 3P0F、exit0。
- 写入/sync/close 故障与 loser 清理失败 4P；manifest 原生部分写入及 sync/close/cleanup 故障 4P。所有失败 stage 保留断言不改；原生部分写入仍核 128 字节和 retry 后原 stage 不变。
- 目录整组 `publishArtifacts` 是不同合同，暂存目录及 `.publication-failure.json` 应保留，相关 2 项实跑通过，不应批量迁移其 EEXIST 或故障 stage 断言。

已记录 all-scripts 定向检索。除本条外，未发现另一个同合同的旧 loser-stage 保留断言；锁 EEXIST、进程 ready stage、transport stage 及 checkpoint 写入/rename 失败与本条不同。最初 test glob 搜索 90 行；随后全 scripts 搜索 94 行，含父 Agent 采纳本次单行改动后读取的记录。

独立执行窗口读取的 16 个 ROOT 路径前后 SHA 全一致。后续只读复查发现父 Agent 已采纳测试这一行，产品/helper/freeze 仍与之前一致。未编辑 ROOT/CODE，未执行完整检查、历史链、模型、评分器、HTTP、提交或推送。

父 Agent 报告的完整检查原始失败继续有效：3860.472597 秒、10346 total / 10344P / 1F / 1 platform skip；本次只是解释并迁移这一条过期测试合同，最终完整复验另行记录。

原始 2P1F 日志、旧脚本 snapshot、单行 patch、逐次 stdout/stderr/exit/版本、故障保留对照及准备错误均保留。第一次取证的无效模块路径与计数解析问题属于取证准备，未混作产品失败。请求模型 gpt-6.1-sol / ultra；实际后端未独立核验。
