# PR45 35b CI 只读核对收据

结论：指定 HEAD `35bdbde669f639a497f8685383e7a3fd7c948c3f` 的 [CI run 39140322673](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39140322673) 第 1 次 attempt 成功；唯一 `check` job 全步骤成功。PR 实际检出测试合并提交 `a90e72d47744a45339e500a30f3ad04e7a7a4705`，其父提交包含该 HEAD；两者 tree 是否相同见 JSON，不能将 PR merge checkout 误称裸 HEAD checkout。

| 实际 CI 检查 | 结果 | 原日志行 |
|---|---:|---|
| Vitest | 46 文件、1789 测试通过 | 1760–1761 |
| 材料测试 | 68 通过、0 失败、0 跳过 | 1927–1932 |
| fact-runtime Node 测试 | 7762 通过、0 失败、0 跳过 | 10412–10417 |
| npm check 内 Python 三套 | 9、11、16 通过 | 1846、1941、1946 |
| v7 HTTP | 322 项通过、cleanup PASS | 10901 与产物 JSON |

CI 环境为 Ubuntu 24.04.5、Node 24.21.0。这里使用 CI 的实际计数，不沿用本机平台的跳过计数。`npm run check` 的构建、类型检查、lint 等步骤随整体成功。另有原基线检查，不合并到 runtime 分母。

下载了 `material-http-regression` 和 `base-http-regression` 两个原 ZIP，下载 SHA 与 GitHub API 的 SHA-256 digest 均一致。材料产物分别记录 text 8、images 17、facts 10、cancel 14、poll 4、recovery 10、v7 322 项通过；cancel/poll/recovery/v7 均明确 cleanup PASS。v7 记录 323 份合成输出、321 份重启快照、原 raw/history 不变、1615 次已鉴权服务交互和 646 次先持久化再退休的 job。CI 的 raw/candidates/finish_reason 序列与此前本机 final-after 报告逐项相同；本次没有启动任何 HTTP 或测试。

v7 明示使用生产处理器的本地 Worker HTTP、临时 D1/R2、真实 TXT/rules 队列和注入的合成输出；`actualModelInference=false`、`holdoutRead=false`、`historicalReportsOverwritten=false`。这证明合成技术回归通过，不是新模型推理、人工标注批准或真实业务验收。

该精确版本 workflow 只有 `check` job，没有部署步骤；对精确 HEAD 的 GitHub deployments 查询为零记录。步骤名中的 “production HTTP” 表示应用处理路径，不表示生产部署。本次复核也未执行部署；不以这些证据断言所有外部发布渠道绝对没有动作。

完整来源、文件 SHA、日志行、计数与限制见 `readonly-ci-review.receipt.json`，复制清单见 `copy-index.json`。本次仅下载与读取 CI 日志/产物、核对 JSON 算术和 hash；未执行 tests/build/HTTP/历史链/模型，没有改 ROOT/CODE 或远程评论、提交、推送。请求配置 GPT-6.1 Sol ultra，实际 backend 未独立核验。
