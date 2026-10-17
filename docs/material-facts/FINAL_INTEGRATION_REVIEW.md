# 最终集成技术复核

复核日期：2026-10-17。复核者：负责过存储/API/UI 的子 Agent；本次检查的进程保护、复现运行器、评分器及 CI 接线均非本人原实现。请求模型配置为 GPT-6.1 Sol / ultra，未另行取得运行后端配置证明。本次未启动模型、读取凭据、训练、部署或操作 Git。

当前结论：**本次发现的异步输出清理与 UTF-8 分块问题均已修复；未发现其余未处理的代码阻塞，完整离线复现验证通过。** 真实退出等待及内存保护回归通过，58 个结果文件、9 次独立运行均经原记录重算验证。运行器修复由本复核者按主 Agent 授权实施，随后由主 Agent 源码复核并进入最终整合检查，不能把本复核者的自检称为独立复核；网站服务解码修复由主 Agent 实施，本复核者已独立检查并复跑测试。

## 发现与处理

### 1. 运行器异步输出错误可能使父进程先退出：已修复并复现对照

原 `experiments/material-facts-v4/run.mjs` 的 stdout JSON 解析、stdout/stderr 文件写入串接在 Promise 队列中，只有子进程 `close` 以后才等待队列。解析或写入失败会先成为未处理拒绝，Node 可立即退出，使仍在工作的推理进程失去外部监控，也不保证完成 TERM、3 秒后 KILL 与 `close` 等待。

修订只增加即时错误处理：保留首个 `writeFailure`，标记 `worker_output_error`，进入原有终止流程；已排队的后续操作不再解析/摄入；等待真实 `close` 后保存失败 attempt/outcome，CLI 退出码为 1。Qwen 异常进程即使此前写出 `stop` 行也不能成为成功业务回答。DeepSeek 在错误发生前已完整结束的独立请求仍按预先声明的口径保留。

原字节已先保存到 `/tmp/anxin-run-frozen-v1.mjs`，SHA256 为 `c3137f5fe6dd6f0b1291f148c02413b265842ec2b9197a515ac26058e7e6c10a`，与原冻结清单一致。包含下述 UTF-8 修复的最终运行器 SHA256 为 `12b5b33d11f2c47754eaff7e00c20c393ab17bbfa7dd86bd8dc53c2cf57d8a0b`。主 Agent 负责正式归档和 amendment；原 `freeze.json`、数据、提示、内核、Python worker、评分器均未由本复核者修改。

新增 `scripts/material-runner.test.mjs` 使用实际 CLI 模块、内存文件系统和受控子进程接口，不加载任何数据集、模型、凭据或网络，也不写运行输出文件。三种场景为无效 JSON、stdout 写入失败、stderr 写入失败。修订版 3/3 通过；对原字节运行相同测试 0/3，分别以未处理 SyntaxError/写入错误提前退出。测试同时断言首次终止、必要时约 3 秒后强制终止、`exit` 后仍等待独立的 `close`、后续候选不摄入、失败 outcome 以及 CLI 退出码 1。

这次修订发生在本轮模型运行之后；本复核者没有重跑任何模型，不能据此声称旧运行使用了新保护或重新产生分数。

### 2. UTF-8 字符跨管道分块时 raw 会被改变：已修复

原 `scripts/fact-jobs.mjs` 的 `out += chunk` 和运行器的 `buffer += chunk` 都对每个 Buffer 单独隐式解码。管道可以在多字节汉字中间分块，接收端因此可能写入替换字符 U+FFFD，破坏原回答与精确引用。

只读受控探针将合成字符串“应发工资5000元”的第一个汉字分成 1+2 个字节送入 `createFactInference`，得到 `finish_reason=stop`，但 raw 为“���发工资5000元”。没有模型、凭据或真实材料参与。

主 Agent 给服务 stdout 增加 `setEncoding('utf8')`，将上限计数改为 `Buffer.byteLength(chunk, 'utf8')`；本复核者只读检查了该改动。新增逐字节中文/emoji 测试保存完全一致的 raw，333334 个汉字超过 1MB 时仍被阻止，服务全部 23/23 测试通过。该改动未放宽输出上限或退出等待。

运行器由本复核者按授权改用 `StringDecoder('utf8')` 跨 Buffer 分块接收 stdout，实际字节仍按 `chunk.length` 计数，关闭后刷新尾部；stderr 原来直接串行写 Buffer，不存在逐块解码，因此保留原始字节写入。第四个受控测试逐字节发送中文和 emoji，断言 stdout raw 与 stderr 文件字节还原均完整、无信号且正常完成。修订版 4/4 全部通过；原冻版对照 0/4，其中第四项准确复现替换字符。旧运行原始字节与成绩未倒改。

分块缺陷能造成 U+FFFD 传输损坏，不能把旧运行的所有引用差异都归因于模型，也不能反推旧差异都来自传输。若要归因模型语义或改字，应另外核对局部差异、保存的 raw 与来源；缺少传输前原字节的旧回答不能由本次修复追溯还原。本报告不重新归因或修改任何旧回答。

## 已完成核查

| 核查 | 实际结果与边界 |
|---|---|
| `node --test scripts/fact-jobs.test.mjs` | 初版 21/21；解码修订后 23/23 通过。覆盖启动前压力、加载/预填充期监控、warning 持续 10 秒、critical、swap 增长、监控失效、600 秒超时、取消、输出字节上限、非零退出、缺失可执行文件、队列退出边界和固定服务端后端。包含真实 Node 子进程忽略 TERM、KILL 后实际退出才启动下一任务的测试。 |
| `node --test scripts/material-service.test.mjs` | 13/13 通过。使用本地受控 HTTP 与合成 OCR；未请求真实模型。包含认证、来源/字段校验、隔离、取消、重启及缓存清理。 |
| `node --test scripts/material-runner.test.mjs` | 最终修订版 4/4 通过；原冻版对照 0/4，错误分别准确落在解析、写入和分块解码路径。 |
| `node --check` 与 ESLint | `run.mjs`、新增运行器测试的语法检查及定向 ESLint 通过。 |
| 原冻结入口 `verify.mjs --data-only` | 在 verifier 尚未进行 amendment 适配前通过：23 个冻结文件、3 个 dev、9 个 holdout。仅检查数据、字节哈希、金标格式及案件族隔离，没有推理。 |
| 最终 `node experiments/material-facts-v4/verify.mjs` | amendment 与 manifest 齐备后独立执行，退出码 0、`status=PASS`。校验原冻结字节、限定修订、58 个结果文件，并重算 9 次运行的保存成绩；没有推理或训练。 |
| 主 Agent 最终整合检查 | 本复核者读取 `experiments/material-facts-v4/verification/final-local.json` 核对：`npm run check` 退出 0，155 项应用测试、50 项材料/运行器测试通过，1 项 Linux Tesseract 检查在 macOS 跳过；该记录也标明主 Agent 已复核运行器修订。此项由主 Agent 执行，不冒称本复核者重新执行，也不代表远端 CI。 |
| 合成评分探针 | 两份计划输入、一个合法候选；正常 `stop` 对照 TP=1。四种非完整结束（`worker_output_error`、`external_memory_guard`、`length`、`request_error`）虽同样通过候选程序校验且保留 raw 基础匹配，accepted TP 均为 0，两份计划 FN 均保留；完全缺失、重复和外来结果 ID 的行为也核对通过。未使用留出答案。 |

`fact-jobs.mjs` 的取消、停止及服务关闭均以子进程 `close` 为释放边界，收到 `exit` 只停止监控计时器。每次异步内存采样后检查退出/停止状态，因此不会用迟到采样去终止已退出进程。启动前无法确认正常内存时不会启动 Qwen；远程后端不依赖 macOS `sysctl`。

评分器按计划输入遍历，未访问的材料仍计漏提；不完整生成可以保留 raw 诊断匹配，但不会获得 accepted 业务成功。DeepSeek 在累计错误停止之前已完成的独立请求可保留，符合 `METRICS.md` 既定口径，不应错误地清空整批先前成功。

## CI 与复现边界

CI 使用 Ubuntu、Node 24、Python 3.12，先安装项目依赖，再运行只读取保存结果的 `verify.mjs`，没有在该命令内调用 Python worker、加载 MLX 或读 API 密钥。macOS 内存探测只在实际 Qwen 运行路径执行。事实链 HTTP runner 使用隔离的本地 D1/R2 与固定 rules 服务，事实回归报告也接入 always 上传。

本机实际通过的运行时为 Node 26.11.0 / macOS。没有声称执行过 Ubuntu/Node 24 或远端 CI。本机已有 Node 22.23.2 二进制因缺失 `libsimdjson.33.dylib` 启动失败，未安装或修改系统依赖；此环境失败不计为运行器测试失败。主 Agent 已将新增运行器测试接入 `test:materials`，随 `npm run check` 进入 CI；本复核者未因此宣称远端 CI 已通过。

最终验证入口同时核对原冻结源码快照与限定的 `run.mjs`/`verify.mjs` 修订哈希，原 holdout protocol 继续绑定原 freeze。完整 verify 已由本复核者独立执行通过。额外只读元数据核查确认：9 次运行都将 protocol、results、outcome、assessment、messages 五类必要文件列入 manifest；4 次 holdout 都有 9 份计划输入、完整的五项协议源码哈希与同一冻结输入，每次单独评分；manifest 无绝对路径，也没有会被现有 `*.log` 忽略规则遗漏的日志路径。依赖清单对应的文件在本机均可读，远端 checkout/CI 仍由主 Agent 的最终交付报告。

原 `freeze.json` SHA256 仍为 `8f93162afe9650580ce578a1cdd78a6528f99860f97ac4274f5fc78282959149`。正式归档的 `frozen-source/run.original.mjs.txt` 与 `verify.original.mjs.txt` 分别匹配原 freeze 的 `c3137f5f…`、`a75c4f3a…`，当前 amendment 只允许这两个脚本改变，其他数据、提示、内核、worker 和评分器继续逐字节验证。运行器故障清理与传输修订不追改旧运行，没有模型重跑。这里的静态接线、局部自检、整合检查、远端 CI 和人工验收分别报告。
