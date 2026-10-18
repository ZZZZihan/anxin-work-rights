# R39 CI 最终线程清单补充

原始成功CI结论和实际计数保持不变。此次刷新实际为 **146线程/8未解决**，本轮原四条R39均已resolved。此前143线程快照有五条新问题；同一刷新又包含19:51Z新增的双倍、RMB限定金额canonical、会计括号三条，因此新的未解决合计为八条。原收据五条清单的范围文字由本补充更正，原件与旧索引保留。

八条完整body、线程ID、路径、时间和resolved/outdated字段存 `all-eight-unresolved-reviews.complete-bodies.json`。这仅是读取审查发现，不声称已复现或修复；最终状态为 **CI_PASS_APPLICATION_BLOCKED_NEW_REVIEW**。精确5374的CI仍27步骤成功、9492runtime通过、68materials通过、HTTP464/465raw/463restart和OCR17通过。
