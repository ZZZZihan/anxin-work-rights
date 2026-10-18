# ROUND31 独立轻量复核

本轮四项具体问题及小时费率字形启用后暴露的“待定”交叉回归，在所核查的最终字节下未见未解决阻塞。结论限定为纯模块技术复核；未执行运行时入库、历史读取、评分器、HTTP、完整检查或人工业务验收。

固定基线 `496fb2740593c9c1d4ba95578686310c2caf2798` 的同一有效 schema 20 项在 Node 24.22.0 与 Node 26.11.0 均为 11 通过、9 失败、exit1。中间 money `40f5fb23` 同组均为 19 通过、1 失败；最终 money `68f3f196` 同组均为 20 通过、0 失败、exit0。Node24 最终用时 0.249 秒，Node26 为 0.476 秒。20 项是测试容器，包含有限循环断言，双运行时不构成 40 份独立材料。各正式运行前三个目标文件与运行后哈希一致。

最终文件绑定：

- `lib/material-money-v4.ts`：`68f3f196c5a059b9c97b2ab366003570070c7cfce7b7bb17130cdd1fca26dcea`。
- `lib/material-fact-event-review.ts`：`4ec96de5642643333ec1dff5b9c2c6bb53f3295c27dcf82c9042547c42d2b2f4`。
- `scripts/owned-http-process-group.mjs`：`d6d555d521f1cf251da4ee5da8f0e3322e33b5570b71a71fc46bbb47f1fdfc06`。

日期补丁只将完整每月支付日尾字扩为“日/号/號”，保持 1–31、完整值和领取工资线索约束；“際/係”只进入日期关系检测副本。独立反例包含非法日期、裁剪后缀、错误角色、其他主体、群体和否定，原始候选对象未改写。该函数支持某项归属，不代表运行时接受该事实或事实已获法律/人工确认。

金额补丁在检测副本折叠“時”。独立测试发现，中间版本会把 `王甲工资4000元/小時待定`、value=`4000元`、meaning=`rate`、rateUnit=`hour`、completeness=`not_applicable` 解析为 exact/4000.00；旧基线为 unsupported/null，最终恢复为 uncertain/null。最终补丁只穿透一层已支持的 `/或每+单位` 后检查原有紧贴未知标记，继续保持显式算式 unsupported 的优先级。源代码静读未见该有限变更扩大到其他人物或分句。金额分子可在正确的 hour 费率属性下解析，不意味着它是工资总额或获准自动计算。

Windows 改为启动前抛 `ERR_OWNED_HTTP_PLATFORM_UNSUPPORTED`。独立测试在真实 helper 源码上只替换平台和导入，断言零 spawn、零 signal，选项无法绕过；另保留 POSIX detached/负进程组信号和非自有对象拒绝断言。静读四个 HTTP runner 的迁移与 Worker 启动路径均调用共享 owned spawn。这里证明的是拒绝不受支持的平台，不能称 Windows 进程树清理已在原生环境验收。本复核没有启动或杀死任何真实 OS 子进程；原有 POSIX 清理循环未改变。

初版独立工厂把 rate 的 completeness 写为 unknown，属于夹具 schema 错误。已保存原脚本和全部日志，只把工厂缺省改为 not_applicable，未改任何预期断言；上述正式红/中间/绿均在更正后重新实跑。初版 draft 不用于正式产品结论。

测试校验候选对象原样、normalization.rawValue 原样，以及有匹配 span 时 raw value 的码点切片等于 matchedText；没有把这些断言写成数据库原始输出留存或源文块 CP 的验收。原失败、中间回归、最终 stdout/stderr/exit、源字节快照和更正说明均随 copy index 追加保存，旧报告没有覆盖。

请求配置为 GPT-6.1 Sol / ultra；实际 backend 无法独立核验。未调用模型、训练、部署、提交或推送。完整整合、HTTP、CI 和人工业务验收按主侧各自证据另列，本收据不冒称完成。
