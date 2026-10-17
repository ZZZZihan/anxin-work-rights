# 运行修复与证据边界

本轮跟踪 Issue #37，追加到 PR #36；不训练、不合并、不部署。

## Qwen

旧回执显示首 token 前内存 warning 持续十秒，外部监测发送 SIGTERM；没有 OOM、崩溃或当时 swap 增长证据。新的只读源码核查和无模型实测发现，MLX-LM 的生成 context 会把设置的 wired 20 GiB 改成设备推荐值 51.84 GiB，结束后再恢复。allocator guideline 24 GiB 未被覆盖；它不是严格硬上限，wired capacity 也不代表预分配相同容量。

新 helper 只在项目 worker 进程中替代 context，设置并回读 20 GiB，关闭生成器、同步 stream 后恢复；未修改 site-packages。加入阶段内存记录，外部压力/超时保护保持原值。相关官方机制：[MLX wired API](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_wired_limit.html)、[memory guideline](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_memory_limit.html)。

`diagnostics/qwen-dev-1` 证明单改上限不够：after_load 的 MLX active 18,429,683,720 bytes，约 17.16 GiB，pressure=2；swap 从约 1.84 GiB 升到约 4.33 GiB，预填充 processed=0。18.172 秒后原保护停止，未得到答案。这个失败保留，不能从最终报告删除。

用户随后明确允许正常退出 Chrome、豆包、WorkBuddy。只发送正常退出请求，没有强杀；WorkBuddy 和豆包主程序退出，豆包输入法保留；Chrome 有其他实例/进程残留，因此不声称全部 Chrome 已退出。释放资源后 `qwen-dev-2-apps-closed` 三份全部产生输出：stop、length、stop；没有再出现内存保护。第二份 length 是达到固定 4096 token 输出预算，不是运行崩溃。新诊断沿用已有 swap 作为每进程基线，不清 swap，不降低保护要求。

dev-2 是实现期诊断：其运行期间给后续 worker 增加了固定模型身份检查及安全 fatal category，未改模型、提示、生成参数；因此该目录的启动 code hashes 不能用来声称三份诊断全使用最终代码。正式运行另行冻结，在正式批次开始前检查 108 项摘要，各后端运行 protocol 与该 freeze 逐项对齐；逐 worker 检查模型身份。

正式复测的所有逐文书 load/wired/prefill/first_token/generation 证据在 `results/qwen-1/events.jsonl`，外部观察在 `memory.jsonl`。完整结果的峰值与时长由 `comparison.json` 汇总；不从 RSS 相加估算可释放内存。

## DeepSeek

旧三轮八次 URLError 均约 5.01–5.03 秒，未保存底层原因。本轮本机无认证公开请求复现了 SSLEOFError：TCP 很快连接，TLS 约五秒非正常断开；Python/curl、TLS 1.2/1.3 均可发生。不能把所有旧错误逐次追认为已经证实的 TLS EOF。

测试机出口累计 12/12 无认证请求得到预期 HTTP 401；本机相同 Python/OpenSSL 经临时回环 SSH 转发，3/3 得到 401，约 0.14–0.22 秒。401 只证明网络/TLS/HTTP可达，不等于认证生成已通过。本机直接访问测试机解析出的 IP 仍超时，因此没有固定 IP 或修改 hosts。详见 `diagnostics/network-summary.json`。

本轮通过已有测试机建立临时回环转发，TLS 在本机到官方域名终止，密钥不复制到服务器。每份材料显式先完成 TLS，再 POST 一次；仅发送前连接失败可有限重试，证书失败不重试，发送后的失败不重投。不跟随重定向，不关闭证书校验；即使 socket 丢失，标准库也不能自动重开连接。每个连接、提交、响应事件分别保存。

`diagnostics/deepseek-dev-1` 三份均 stop；正式 `results/deepseek-1` 九份均 stop，九次连接、九次 POST，未用重试挑答案，隧道关闭回执已保存。这是当前出口下的可用方案，不声称本机直接出口已被永久修复。后续运行仍需测试机可达；默认应用没有偷偷启用隧道，只在配置 `ANXIN_FACTS_DEEPSEEK_TUNNEL_PORT` 时使用显式本机回环端口。

## 运行与服务

应用事实提取服务已指向 `scripts/fact-runtime-v2.py`，原 `fact-inference.py` 留作历史冻结证据。新 runtime 继续只产生候选，不能直接写入可信金额。服务层保留实际 close 后释放队列、取消、输出限制及 Qwen 外部监测；服务层绝对单文书上限仍为 600 秒。本轮专用评测运行器另外给 DeepSeek 每份 180 秒绝对截止、socket 120 秒和整批 2400 秒截止。

重新运行必须用不存在的新目录。Qwen 运行器参数保持旧模型路径和 integrity 目录；DeepSeek 可以从仓库根目录使用 `python3 experiments/material-facts-v4-replication-20261017/run-via-test-egress.py --mode replication --inputs experiments/material-facts-v4/data/holdout.inputs.jsonl --out <新目录> --key-file <本机私有凭据路径>`。脚本只创建并清理自己所属的 SSH/运行进程，既有应用与隧道不受影响。
