仅供主 Agent 集成的建议，不已应用到 ROOT。

- 原 v23 gate 路径保留，但使用本次历史适配内容。test:fact-runtime 增加 v24 current gate 和 v23 native bridge test。
- CI 保留所有既有只读验证；将最后当前 v23 check 转为 verify-correction-v23，再运行 v24 --check。
- 门禁允许外层 960000ms，v24 两个顺序 negative CLI 测试总上限 1980000ms；内部嵌套历史检查继续共用原 900000ms absolute deadline，逐层扣除原 2000ms 清理余量。未改变旧政策。
- 上述真实 v23/v24 gate 和 CI 命令本次均未运行，必须在最终产品及 v24 五文件正式产生后由主 Agent 执行。
- Windows HTTP 生命周期拒绝属于应用技术证据，不列作 v24 91 份评分依赖已覆盖内容。
