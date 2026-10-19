# R39 精确提交 CI 只读复核

精确提交 `5374d66748a7c329c4c595ec91372d324edff573` 的 [CI 39159983288](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39159983288) 实际终态为 **SUCCESS**。结论为 **CI_PASS_APPLICATION_BLOCKED_NEW_REVIEW**：此次 CI 通过，后续五条审查另列待修，不据此声称整个应用已完成人工验收。

原始 ZIP、逐步骤日志和 API 已归档。27 个步骤全部成功；Node v24.21.0；Vitest 1789/46；runtime **9492/9492，0 skip、0 cancel**（82.113 秒）；materials **68/68，0 skip**；Python 9/11/16；ESLint 0 error、22 warning。原先端口替换/连接重置的三个夹具断言及九项重复信号 CLI 用例在本次日志中实际通过。

实际 checkout 是合并提交 `02813ffcd3f83c31e37b414a2f03f07f144cf767`，包含精确应用 head；head、checkout 和本地被测树的 tree 均为 `a20e02e3bc0914a9bf6deabb661f713e3ab5784f`。89 个当前源码/夹具路径逐字一致。

HTTP v7 **464 PASS / 465 原输出 / 463 重启快照**，cleanup PASS。465 项只剥顶层 `evidenceId/jobId` 后与主侧原输出一致，raw UTF-8、candidates、finish_reason 逐项相等；464 项 observations 也相等。cancel14、poll4、recovery10、facts10、production8、OCR17、基础21和合成30均 PASS。OCR 引擎记录为 Tesseract/Poppler 与规则，model 为 null。

两个原 artifact ZIP 的 SHA256 同时匹配 API digest 和上传日志；11 个成员按白名单保存。原始模型结果等147文件、旧失败107文件、11个历史manifest复核未改。v6 历史原 verify/summary 在专有临时树实际执行，不能当作当前产品验证。精确 head 与 checkout merge 的 deployment API 均为0条，仅表示这两次查询的范围。

第一次终态读取为143线程/9未解决。刷新后为 **146线程/8未解决**。原四条R39状态另存；五条新评论完整正文存 `five-new-reviews.complete-bodies.json`，本次只读转述，未扩大复现或修复范围。原先未解决快照完整保留，不覆盖为后来的状态。

本审阅没有运行本地 fullcheck、HTTP、scorer、历史CLI、模型，也没有重跑CI、部署、发评论或解决线程。主侧本地检查和HTTP均明确归属主侧；CI与合成材料检查不等于真实案例、法律判断、实际银行到账或人工业务验收。`calculation_authorized=false` 是固定政策字段，不代表已实测真实UI授权。

请求配置沿用 GPT-6.1 Sol / ultra，实际 backend 无独立核验渠道。复制索引仅包含本目录证据，旧失败记录保留。
