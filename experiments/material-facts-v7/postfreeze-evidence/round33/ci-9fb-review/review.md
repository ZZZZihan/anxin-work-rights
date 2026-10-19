# exact9fb CI 失败只读核查

精确提交 `9fb69c543f15862d7aaaafacdc3a392de5e48f36` 的 [Check run39144615912](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39144615912) attempt1 为 **failure**。实际 checkout 是 PR 合成 merge `cc36f5339d9c74e824be546c47331926281681ea`，父提交含该精确 head；GitHub Git API 的两个 root tree 均为 `8b13e6ba75bca6526a0cdc6ad34bf5f585fcca63`，因此工作树等同此 head。环境为 Ubuntu24.04.5、Node24.21.0。

唯一失败在 job117725817813 的 step10：`node experiments/material-facts-v6/verify.mjs` 拒绝当前 `lib/material-facts-v3.ts`，实际 SHA `77283a7b0677a43a9c3ff62bf78f353dfbfc6f359c63c1388ea81a7f2ccac779`，v6 冻结期望 `b1e5fbe9829cd677c98315070fd3406dfadd6305a3291dfa601a3df64874cbdd`；精确 head 的 v6 freeze 文件也记录该旧值。这是历史冻结校验入口读取当前产品代码的冲突。不是已执行 Linux helper、HTTP 夹具或当前产品测试后的失败；这些步骤尚未执行。

`npm run check`（runtime/Vitest/materials）、OCR 工具安装及全部生产 HTTP/取消/并发轮询/恢复/v7/OCR 回归均 **skipped**，没有本次可报的通过计数、HTTP352/raw/restart 或 cleanup 结果。此前 v4、replication、v5 冻结校验通过；shell -e 在 v6 verify 失败后没有执行 v6 summarize。

两次 upload action 标为 success，但均警告找不到文件。artifact API `total_count=0`，因此不存在可下载或比对 digest 的 HTTP artifact，不得把上传步骤 success 当成 HTTP 通过。原始完整 run log ZIP 已保存，38612字节，SHA `ec87917381b1a248aef781fed9738710a317178cfb82f1a9231efc3606e66443`；这是下载后重算的日志 ZIP 哈希，不是 artifact API digest。

精确 workflow 没有部署步骤，exact-head deployments API 返回空数组。此结论仅限该 workflow 与这次 API 响应，不泛称所有外部部署渠道。CI 技术行为不等于人工业务验收；此前本机 HTTP352 也不能算成本次 CI 的执行结果。

没有改旧冻结/预期哈希、产品或 ROOT/CODE，没有运行本机测试、build、HTTP、历史 CLI/scorer 或模型，没有重试 CI、发评论或推送。主 Agent 已将冻结入口修复交给另一 Agent，本收据仅保留失败证据并待命。请求 GPT-6.1 Sol / ultra，实际 backend 无法独立核验。
