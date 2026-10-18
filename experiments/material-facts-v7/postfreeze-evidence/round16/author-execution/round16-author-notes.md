# ROUND16 作者交接与检查范围

v12 归档先于 ROOT 产品修改完成。按原 v12 manifest d74fb4e43136d6c0a18739daa79065e8ceaef6519ce2d9ddf82de72650a1184e 捕获 55 份 code_sha256 绑定，先在内存核全数，再独占创建 correction-code-v12；写后重算全部一致。归档 manifest SHA95f39f9d2053ac5c9067ab254d8a2fc0a7f12f36486692d1915f3740987a1338。旧归档与原始结果没有改动。

新 historical-v12-execution 只准 corrective-assessment-v12.mjs --check；旧 policy、v9/v10/v11 bridge 不改，继续同一个 15 分钟绝对 deadline、每层 2 秒清理余量。新 verify-v12 恢复55份代码；新 controller-v13 先用真实旧 v12 只读验证，再 compute 当前一次，当前绑定55+3=58。v13 reason 只记录本轮不完整金额区间端点的换行与邻block续接，不引入新推理或改历史分数。作者没有执行 v13 --write 或正式 --check。

作者实际跑 native contract 7/7 PASS（真实 Node subprocess、合成 CLI fixtures）和真实 wrapper 的轻量夹具6/6 PASS（55份字节恢复、callback异常清理、missing/changed/extra/manifest字节篡改前置拒绝）；6个交付文件 syntax 与真正 scoped ESLint exit0。完整历史链与正式v13产物门禁由ROOT后续执行，不能用这13个轻量检查替代。

旧 v12 current gate 在转换成 historical-v12 gate 前，原字节独立存到 v12-gate-own-before.snapshot 以及 material-facts-v7-correction-v12-gates-independent.test.mjs.root-v12.snapshot。测试文件未写进旧 code 归档绑定，不改旧快照。当前 v13 gate 的2个 native --check子进程各用960秒外层预算，顺序父门禁1980秒；内部历史执行仍为共享绝对15分钟。

HTTP90修复前基线是后来按ROOT明确授权，从精确 Git commit 2c1b270523e719111798c50ce8605de1e7e1351f 新建任务专用 git archive，未用已被重建的旧1c目录冒充。源码 archive tar SHA13b143eb15fb3774d4369cb938d80527b80e8e04cf8713d0b3a024b70388c405；npm run build 实际exit0，完整日志及105产物hash保存。依赖使用可信现有 node_modules 符号链接，没有安装或改全局配置。构建后5个关键应用文件与2c Git blob逐字SHA匹配。

Money提供的90runner SHA7c9eb65bc847b1daa02670ca3ef5b41fa9fb2ff35d1e74a3fed34b724b20b1b3。其自身目录没有同名helper，作者未运行一个必定缺import的入口，而是将该文件与匹配37c86a25…helper字节复制到任务私有runner目录；不覆写oldarchive源码或正式runner。ANXIN_MATERIAL_V7_BUILD_ROOT 指向精确2c隔离构建。原始独占HTTP结果以实际报告为准；这是loopback Worker+临时D1/R2/TXT真实HTTP和明确合成事实输出，不是模型/业务验收。

不提交、不推送、不训练、不部署；主Agent统一接线、最终build及全链验证。
