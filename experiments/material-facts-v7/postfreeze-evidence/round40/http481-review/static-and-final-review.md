# ROUND40 HTTP481 夹具与结果只读复核

结论：本次限定范围内未见实质阻塞。读取主 Agent 实际运行产物后，最终报告为 **481 PASS、482 份合成原始输出、480 个重启持久化快照、cleanup PASS**，运行回执为 exit 0、30.987 秒。复核者没有启动 HTTP、构建、完整检查、历史评分链或模型。

复核者参与了本轮总额事件实现，因此这里只称 **HTTP 夹具及保存证据的非实现者技术复核**，不称相应产品源码的独立验收，也不称人工业务验收。请求配置为 GPT-6.1 Sol / ultra；实际后端未能独立核验。

- 最终 runner SHA256：`570aa0135dff64913dfd120b986f5cd5326edee95a030c774e7fb11ca08a6bd2`。删除唯一 ROUND40 新增块（1754–1798 行）后，与 exact `5374d66748a7c329c4c595ec91372d324edff573` 的旧 464 场景 runner **逐字相同**。
- 最终与两次旧服务运行均有 482 份输出、508 个候选条目；仅去除各输出最外层随机 `evidenceId` / `jobId` 后，**原始 raw 字符串、完整 candidates（含 blockId）和 finish_reason 按顺序逐项相同**。
- 与上一轮真实 `http464-after.json` 比较，463 个旧非重启观察逐字段相同。删除新输出区间 `[460,477)` 后，恢复旧 465 份输出；重启实际快照数从 463 增为 480。此计数不是模型响应数。
- 新增 17 项为：8 个上限/双倍/会计括号的完整或裁剪金额；3 个小时费率（其中待定仍为 null）；2 个限定 RMB/CNY（仍为 approximate/null）；2 个应发/实发总额；2 个日期角色。

八个不可靠金额均先测试新提取为 null，再在隔离 D1 中人为设置旧 exact 4000 元，实际 GET 重审后为 null；随后比较存储行、原始输出和历史未被回写。这里不额外推断未断言的 normalization status。新旧运行中的失败场景在第一条失败断言处即停止，不能把旧失败之后尚未执行的历史重审步骤倒计为覆盖；最终运行八个场景均执行完毕。

应发、实发场景实际提交合成 `confirm_scope`，范围和原文主体、期间一致，分别得到 due 4000 元、paid 3500 元建议。两场景同时断言金额确认仍为 null、`canCalculate=false`，随后实际撤销范围确认并断言回到未确认状态。`verified:true` 是本地合成 API 动作，不是有人对真实业务作了验收。日期不补造年份，也不确认金额。

公共路径核对了真实 TXT 上传与下载字节、source SHA、原 quote/value、Unicode 码点区间、原候选 representation 和 raw 保留。服务固定 rules，只有真实队列 ready 响应替换为显式合成 raw，不运行真实模型。2410 条记录的内部服务调用均 authenticated，964 次服务任务回收均在持久化后；Worker/D1/R2、服务及临时资源最终 cleanup PASS。报告使用排他创建，已有失败报告未被覆盖。

必须保留的三次运行口径：

| 文件 | 实际结果 | 证据用途 |
|---|---|---|
| `http481-before.json` | 466 PASS / 15 FAIL；465 restart | 旧服务初始记录；小时待定一条读取不存在的顶层 rateUnit，是夹具错误，不能算产品缺陷 |
| `http481-after.json` | 467 PASS / 14 FAIL；466 restart | 修正字段后仍是旧服务，且与 build 重叠；文件名过早，不能作为修后或精确构建验收证据 |
| `http481-final.json` | 481 PASS；480 restart | 在实际 build 完成后单独运行的真正最终报告 |

复核的重启合同是持久化 state/raw/history 不变，未声称重启后重新逐项断言所有派生金额。旧历史 unsupported/null 不自动升级等原断言通过旧 runner 逐字继承，不能据此声称支持任意金额语义。此次仅作 HTTP 证据审查；没有重做原 124/60 全保护核验、模型实测、法律结论或人工业务验收。

可复制索引为本目录 `copy-index.json`；34 个实际读取输入文件 SHA 见 `read-input-hashes.json`，后验散列不变见 `input-protection-after.json`，逐项差异与三个阶段失败首断言见 `report-comparison.json`。所有原始运行报告/日志仍在 CODE `.scratch/issue42/round40/`；旧 464 实际报告在 CODE `.scratch/issue42/round39/http464-after.json`，本目录只新增审计文件及 runner 快照。
