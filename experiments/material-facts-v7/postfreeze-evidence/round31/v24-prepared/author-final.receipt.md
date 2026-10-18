本次只在 OWN 的独立准备目录中生成 v24 工具，未修改 ROOT/CODE。

已完成：

- 从冻结 v23 manifest 的实际 code_sha256 捕获 88 份原代码，逐份核对源字节和 snapshot；捕获后再次核对 ROOT 源字节及 manifest。v23 manifest SHA：`e41acaf87e52dda27236aabbddd0c509c1d9762eaf46ef2e46314030e7f1b56c`。新归档 manifest SHA：`ee708f860f36e7daefa543ebbb4cb4f6eff223097848bad0b82aebecd0ec383b`。
- 新增 exact v23 --check bridge、v23 archive wrapper 和 v24 current controller；预期当前依赖并集 91，旧 v1 policy 和所有旧 bridge 字节不变。仍共用原 900000ms absolute deadline，逐层扣原 2000ms cleanup reserve；不重置每层预算。
- 准备旧 v23 gate 的历史适配、新 v24 gate、7 项 v23 native bridge 测试；原 current v23 gate 单独留原字节 snapshot。
- 7 项 native 合成子进程测试实际 7P/0F；六文件语法检查通过。合成 CLI 仅报告状态/退出码，不导入或运行历史 assessment/scorer。

未做与交接边界：

- 未运行真实历史 CLI、scorer、任何复评 write/check、fullcheck、build、HTTP 或模型。v23/v24 两个 gate 尚未运行；v24 结果、分数、最终产品 hash 均没有生成或声称通过。
- ROOT 全检查仍由主 Agent 协调；准备目录中的 88 个 live 文件只是只读支持副本，**不能整棵目录覆盖 ROOT**。实际复制范围只限 copy-index 指定的 archive、六工具/测试和必要证据。
- package/CI 仅提供 patch 建议，未应用；新 controller reason 仅描述评分依赖中的号/號、際/係日期 cue、時小时费率和费率后不确定续文。Windows HTTP 生命周期证据不冒充该 91 依赖复评。
- 这是首跑后的版本化复评准备，不是原冻结前设计，也不是新独立模型输出或人工业务验收。旧失败和历史档案保持不变。
- 请求配置 GPT-6.1 Sol / ultra；实际 backend 无法独立核验。未创建额外子 Agent。

补丁：`v24-tooling.patch` 是原始六文件审阅差异；`v24-tooling.apply.patch` 补充标准新增文件标头便于应用。归档 88 snapshots 由目录复制，原目录不存在时才创建，禁止覆盖旧 archive。
