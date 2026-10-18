# HTTP342 最终前后证据只读复核

结论：读取主侧实际JSON与执行日志后，最终同342合成HTTP证据闭合。本人没有启动HTTP/build/测试/历史链/模型。原 static-before 收据及索引 SHA 均未变，本件追加。

| 对照 | 固定35b修前 | 最终修后 |
|---|---:|---:|
| 场景 | 325P17F | 342P0F |
| 合成raw输出 | 343 | 343 |
| 重启完成快照 | 324 | 341 |
| cleanup | PASS | PASS |
| 实际命令退出码 | 1 | 0 |

最终执行收据时长27.414589秒；after JSON SHA `96c3f2d92f5f9d323be45aed19e0cc234bc1edc3ed12f867aaf26e5268bf392e`。前后锁定runner SHA `09199ef014f90e475f339900da7332ba9232f80bf9dbc3e76fbdf5be9d4141e5`，同343份 raw/candidates/finish_reason 逐项相同（342 stop、1 length）。移除索引318起20份还原旧323份；旧321项非重启结果与修前及旧322 final完全相同。旧322源码逐字保持已由前件核对。

新增20项全部通过：概数8、日期4、普通角词4、显式RMB角词4。7项概数的历史exact4000.00与4项人民币五角星的历史exact0.50，共11项实际执行种值后GET降null，并断言数据库revision/state/history不被读取改写。另一个独立分句概数正控仍exact4000。两个明确每月日程支持payment_date；另一人/否定仍保留关系警告。4个普通角词拒收保raw；4个显式RMB角词接受为待核候选但金额null。

所有新增项均有raw与存储历史保持断言；shared accepted-candidate检查核原quote码点、sourceSHA和representation，不改value/subject。拒收条目没有accepted-candidate的CP位置断言。提取、GET及重启均保持未确认不可计算。最终341份重启快照只重核存储/raw/history/未确认，不声称重新断言全部衍生金额或warning。修前17项在首fresh断言失败，后续种值/GET/snapshot当时未执行，本件没有倒计。

最终1715次已鉴权服务调用（POST343/202、GET343/200、DELETE1029/200）；jobs与fact-jobs各343次退休，总686次均在Worker持久化后执行。failure/interruption均null，cleanup PASS且failures为空。

这是生产处理路径的本地隔离Worker/TXT/rules队列与注入合成输出的技术回归，actualModelInference=false、holdoutRead=false、历史报告不覆盖。本人参与event实现，仅作为非HTTP作者核对夹具/报告，不称自己产品独立源码审查，不代表新模型比较或人工业务验收。请求Sol ultra，实际backend未独立核验。精确文件SHA、案例名与原执行收据见同名JSON；复制入口为final-copy-index.json。
