精确应用提交 `1cc56d6bc52b67f5c53e7805a9bac0614dfaecd1` 的 CI **失败**，不是通过。

来源：[Check run 39146980559](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39146980559)，attempt 1。实际检出 synthetic merge `5b45b215d3fc2bcdd7c99c4b21794d37b581452f`，与 head Git tree 同为 `43eca9c2b434b0c29b71018645882cac5ee30cc4`。原始完整日志 ZIP 已保存，SHA `7614ed27826e2aa00dde16bf58a15f31b1ed240d79f6a8c68c1c9f706c6fe036`。

- 实际成功：前置冻结检查；npm check 中 typecheck 与 lint（含 warning）。
- 实际 Vitest：1787通过、2失败，共1789；46文件中44通过、2失败。失败为源文换行边界金额预期80000而实际null，以及“王甲工资四万元/月以上”的状态预期rate_unit_mismatch而实际unsupported（两者金额均null）。没有本地重放，不猜第一个循环实际失败于哪条输入。
- npm 的 && 在 Vitest 失败处停止：本次 build、应用数据/材料/runtime套件没有实际通过计数。工作流后续 base/synthetic/material HTTP、取消、轮询、恢复、v7 HTTP367和OCR全部skipped。不能引用本地367P/raw368/cleanupP冒充本次CI证据。
- Artifact API 实际0；两个upload步骤显示success并不代表发布了artifact，因此本次没有artifact ZIP或digest，不能完成CI与本地raw368的比对。
- exact-head deployments API 返回[]，该workflow未配置deploy步骤；只对本工作流/API范围作“无部署证据”声明。
- 仅只读获取GitHub产物与日志、保存证据、JSON核对；未触发CI重试，未运行本地test/build/HTTP/history/scorer/model，未写远端或修改产品/金标。

已保存本地合法http367-final报告快照，仅供后续成功CI比对。reviewer参与event/source实现，因此这是CI证据复核，不是产品实现独审或人工业务验收。
