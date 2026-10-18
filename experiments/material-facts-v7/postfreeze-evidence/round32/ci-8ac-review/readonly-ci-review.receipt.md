# PR45 8ac CI 只读证据复核

结论：[CI39142356614](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39142356614) 精确绑定 HEAD `8ac64640429017f2183b3ae0cde8f02a10cedfa4`，第1次 attempt success，唯一check job全部步骤success。实际PR checkout为合并提交 `246456956962e7e7b5d7ab44fce7f5fe756e0c70`，父含8ac，其tree与8ac完全相同，不能误称裸HEAD checkout。

| 实际CI计数 | 通过 | 失败/跳过 |
|---|---:|---:|
| Vitest | 46文件、1789测试 | 0失败 |
| fact-runtime Node | **7944** | **0失败、0跳过** |
| 材料测试 | **68** | **0失败、0跳过** |
| npm check内Python | 9、11、16 | 均OK |
| v7 HTTP | **342** | 0失败、cleanup PASS |
| 中文图片/PDF OCR HTTP | **17** | 0失败、服务重启PASS |

环境为Ubuntu24.04.5/Node24.21.0。基线HTTP21、合成隔离HTTP30、text8、facts10、cancel14、poll4、recovery10亦通过；cancel/poll/recovery/v7均有明确cleanup PASS，不能给没有cleanup字段的产物虚构该字段。

[material-http-regression产物](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39142356614/artifacts/12142332014) ZIP SHA `fdd702c6cef2eecafd27c2783fa8846439ec10dc5a34b7f247483d1c6a88dd98`；[base-http-regression产物](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39142356614/artifacts/12141693248) ZIP SHA `2ff76b74a3131008af623789ea0601e68b17a5e5ad690090f6d3cf518c770f8c`。二者下载bytes与GitHub API digest一致，原ZIP/解压JSON/原日志及SHA均保留。

v7含343份合成raw输出、341份重启快照、failure/interruption均null、cleanup failures为空。CI的343份raw/candidates/finish_reason和342项observations与本机final报告逐项完全相同；精确提交runner SHA仍 `09199ef014f90e475f339900da7332ba9232f80bf9dbc3e76fbdf5be9d4141e5`。1715次服务调用全部已鉴权，686次jobs/fact-jobs退休均先持久化。重启只重核存储/raw/history/未确认，不声称再次逐项检查全部衍生金额。

OCR使用真实平台工具处理合成中文图片/PDF，报告采用punctuation-equivalence，并覆盖来源引用、归属隔离和服务重启。v7明确actualModelInference=false/holdoutRead=false/历史报告不覆盖，属于本地隔离Worker、临时D1/R2、真实TXT/rules队列及注入合成输出的技术回归，不是新模型调用或人工法律业务验收。

[精确版本workflow](https://github.com/ZZZZihan/anxin-work-rights/blob/8ac64640429017f2183b3ae0cde8f02a10cedfa4/.github/workflows/ci.yml)只有check，没有部署步骤；GitHub对该精确HEAD的deployments查询为空。这里只能说明本workflow/API范围没有生产部署，不能证明外部发布渠道完全没有动作。步骤名production HTTP表示产品处理路径，不是线上部署。

本次仅只读轮询/下载GitHub原日志和产物、核对hash与JSON算术，没有执行测试/build/HTTP/历史CLI/模型，也未改ROOT/CODE、评论、提交、推送或部署。不是原124/60全保护验证。我参与event产品实现，本件是CI证据核对而非自己产品源码独审。请求GPT-6.1 Sol ultra，实际backend未独立核验。精确行号、原来源和细项见JSON，复制入口copy-index.json。
