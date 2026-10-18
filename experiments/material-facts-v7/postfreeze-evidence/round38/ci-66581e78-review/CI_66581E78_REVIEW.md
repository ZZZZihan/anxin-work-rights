本次精确提交 `66581e78f695cf4ed70e9b1bde2f1456814f8b05` 的 [CI 39157925394](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39157925394) 已实际 SUCCESS，27 个步骤全部成功。状态记为 **CI_PASS_APPLICATION_BLOCKED_NEW_REVIEW**：完成核对时 API 共 138 个线程、13 个 unresolved，其中 4 条是新审查（4308319324、4308319327、4308319331、4308319336）。此前 9 条的 API 状态原样保留，不能仅因 outdated 认定解决，也不能只靠 unresolved 认定当前产品仍未修。

实际 checkout 是合并提交 `30f712777593602a6d47b50a0898f1f57f56d05f`，其 tree、精确 head tree 和本机该 head tree 均为 `50ce6d4eedf405162d42618c91a95b8b55edb955`。运行平台 Ubuntu 24.04.5、Node v24.21.0；完整检查有 Vitest 1789/46 文件、runtime 9305/9305（0 skip）、材料测试 68/68（0 skip），Python 9/11/16 全过。ESLint 22 warnings、0 errors。原重复信号 9 项实际 CLI 与新增 reset 夹具均通过；先前 d963 的失败原件 94 文件未变，未被这次成功覆盖。

两个原始 artifact ZIP 的本机 SHA 与 API digest、上传步骤日志三方一致，共 11 成员（9 JSON、2 日志）。HTTP 报告依次为基础 21、合成 30、材料生产 8、事实 10、取消 14、轮询 4、恢复 10、v7 447、OCR 17，全部 PASS；含 cleanup 的四份报告均 PASS/空失败。v7 的 448 份原输出只排除顶层 evidenceId/jobId 后，与主侧本机报告的 raw UTF-8、candidates、finish_reason 全相同，447 项 observation 也全相同。重启保留 446 份 raw/history 快照；这不代表重启后再次逐项验收派生金额。OCR 实际使用 tesseract_chi_sim / poppler 与 ocr_rules，model=null，不是视觉模型实验。

本机原实验结果 147 文件与旧 manifest、精确 head Git blob 一致，复核后未变；当前 17 个源文件/夹具也未变。冻结验证与汇总步骤均执行成功；v6 原验证器和 summary 在拥有的临时历史树执行，current_product_validation=false，只核历史实验，不替代当前产品验收。GitHub exact head 与 merge SHA 的 deployments API 均无记录，此结论不覆盖其它部署系统。

本报告本人只读下载、解析和核对证据，未执行本地 fullcheck、HTTP、build、scorer、历史 CLI、模型、重跑、部署或评审写操作。主侧本机完整检查 104.704 秒退出 0 单独归属于主侧证据。所有原始日志 ZIP、API 返回和 artifact 成员均在白名单索引内；新 4 条完整评论另存 new-four-review-bodies-at-ci-checkpoint.json。请求配置为 GPT-6.1 Sol / ultra，实际 backend 未独立核验。
