# v16 工具非实现者复核

结论：所核范围没有发现阻塞。未参与三个新工具实现的复核者核对了最终源码，独立执行作者准备的 7 项原生测试，实际 7/7 PASS、退出码 0。没有执行真实深层历史 CLI、v16 写入、评分重算、HTTP、全项目检查或模型。

新 v15 execution bridge 与 v15 archived-code restorer 相比前一版只做机械版本递推；v16 controller 除对应递推、change_reason 和既有版本保留列表扩展外没有新执行逻辑。v15 归档共 64 份，逐份核对 snapshot 字节、归档清单与 corrections-v15 代码绑定；下一层增加 3 个模块后为 67 个依赖。原生测试前后，所读产品、原 freeze/result manifest、v1–v15 correction manifests 和 v15 archive manifest 哈希均不变。

旧 v1 policy 仍不可变，新 bridge 仅接受准确 v15 --check，继承同一个 900000ms 绝对根 deadline，每层减去 2000ms 清理储备，不把 v15/v16 加进旧白名单。原生测试覆盖子孙与兄弟预算、双 URL preload、失效状态、超时前拒绝、失败 stdout/stderr/exit 保留、调用者 env/options 与 receipt 所有权。

v16 先在独有临时目录恢复并验证 v15，再调用当前 base computeCorrection 一次；后者先核原始冻结首跑，读取既有三路原始结果并评分。这里的“一次”只指当前层，旧链仍执行其历史重算。发布只指向新 corrections-v16，沿用拒绝已有结果、完整 staging 后发布与失败现场保留；本次未发布。

限制：本地原生子进程测试不能替代深层链的耗时与真实 CLI 验收；两个带深链的 gate 脚本仅静态阅读。初次文本归一化脚本错误处理了版本保留列表的追加，修正比较后吻合；原始源码差异已保留，不是产品或原生测试失败。详细文件哈希、64/67 核对、原生日志和测试前后受保护字节见同目录 JSON。
