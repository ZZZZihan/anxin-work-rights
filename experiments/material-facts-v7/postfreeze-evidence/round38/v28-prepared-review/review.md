v28 预备工具非作者轻核完成，未发现本次范围的实质阻塞；可按 MONEY 的白名单整合归档及六个文件。此结论仅覆盖预备结构和下列轻量实际检查，不能写成 v28 正式复评已通过。

- 重新逐字散列核对 v27 归档全部 100 个代码路径，均符合原 v27 manifest；归档 manifest 为 `528a40a69142978ca6a46885bcf6ff7e2b7063e4b16ff3e208ca411fd3d13f11`，绑定原结果 manifest `37d4f9ae5f64d1dfe97d21a30a0a1d3f7ab4d7df0efa338e2a5f326b0a7cb49e`。新依赖并集为 103。
- 六个预备文件 SHA 与作者清单完全相同。静读 bridge、wrapper、controller 和两代 gate：只允许精确历史 v27 `--check`；旧 policy/桥字节及 900000 ms 共享绝对预算、每层 2000 ms 清理余量保留。两代 gate 的 schema/count/旧摘要与保护版本区间相符。controller 先历史核对再计算当前一次。
- 本人使用 Node 24.22 实际运行新 bridge 的 7 个原生合成测试，7 通过、0 失败。另用独立最小临时 fixture 调用真实 wrapper，核对恢复的 100 个原字节、原 callback sentinel 错误身份透传，以及临时恢复目录删除，均通过；未执行任何历史 CLI。
- 选取 ROOT 49 项旧 freeze/result/correction manifests、policy/桥散列作前后对照，保持一致。这里只是选定 49 项保护核对，没有重验原始 124/60 全集合。
- package/CI 建议保留既有 211 个 mjs 注册和两条 Python 前置、并发 2，仅追加 native27/gate28；CI 将 v27 改归档 verify27、v28 改当前 check。建议未应用到 ROOT。

未运行历史/当前 gate、历史复评链、compute/scorer、v28 write/check、完整检查、构建、HTTP 或模型。v28 尚无正式结果；真实整合、发布和完整历史链验证由主 Agent 后续执行。检查不等于人工法律或业务验收。请求配置为 GPT-6.1 Sol / ultra，实际 backend 不可独立核验。

精确读入文件、检查记录与范围见 `review.receipt.json`；本次仅允许复制 `copy-index.json` 中列出的新证据，不复制预备支持树。
