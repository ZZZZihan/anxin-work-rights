# ROUND40 最终入口文档独立轻审

四份文档未见影响判断的实质矛盾。当前应用提交、精确应用 CI、合成隔离 HTTP、v30 后验复评、非实现者技术复核与尚未完成的人工业务验收，均作了区分。PR46 精确 CI 尚待核对的中间口径没有问题。

直接读取现有 v30/v29 JSON：109 当前代码、106 份 v29 代码；三路报告逐字节相同。六层 F1 与文档表一致，参考分母每路 43；116 raw、104 accepted、12 rejected。46 条 accepted 金额为 19 exact、25 approximate/null、2 unsupported/null，全部有 source_relation_unresolved，无无核对问题的精确金额。46 个 calculation_authorized:false 是报告固定政策字段，不能当作实际 UI 授权测试。

样本限制、7 网页/15 案件项目、3 开发/12 留出、2 网页跨开发/留出，以及 provisional_non_expert、原始失败和无效夹具保留、后验不称新盲测等表述一致。历史 v18 的 21/23/2 明确标历史，不与当前 19/25/2 混用。

仅一处非阻塞时态建议：POSTRUN_ROUND40_APPLICATION.md 第 29 行“v30将另存”可改为“v30已另存”，因为产物已发布。它不影响数字、评分或验收边界。

本次只读文档与已有 JSON，未执行评分器、历史 CLI、测试、构建、HTTP、完整检查或模型；未修改共享文件或 GitHub。输入摘要在复核前后不变。主侧 write/check 与最终 PR46 CI 不由本次文档复核代替；人工业务验收仍未完成。请求 GPT-6.1 Sol/ultra，实际服务后端未独立核验。
