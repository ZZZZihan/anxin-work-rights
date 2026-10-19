Qwen 启动前停止收据：定向修复完成。

精确基线 a8d0b70448a11e62c8b2abe1d02298a3e4d3c04e 的五种初始内存探针失败均发生在 worker 启动前：一次性正式目录已分配、结果为零，但 outcome 缺少 incomplete_stdout，原验证器拒绝封存。修复仅给该 catch 增补 worker_started:false、stdout_state:not_started、incomplete_stdout:false；仍 completed:false/initial_memory_state，不伪造退出码或实际 stdout 流。

Node24 初始同 7 项 2P5F→7P。随后接入 ROOT 加强后的真实验证函数主体及 MONEY 真实原子发布 helper，新增矛盾收据负控，同 14 项旧 runner 9P5F→修后14P。两文件语法通过、局部 lint 退出0；隔离 lint 缺 pages 的提示、初次缺依赖失败均原样保留。

验证使用实际 runner CLI、内存探针子进程与原样验证函数主体；数据/哈希预检、提示构建、评分和预算为明确合成桩，仅选择 Qwen 这一验证后端。未调用模型、网络、真实历史 CLI 或全检查。这不能等同于真实模型/业务验收。

只读重核原60结果文件全部哈希一致，manifest 3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee，freeze 绑定相符。既有12次留出 Qwen 都为真实 worker 成功收据，未经过该预启动失败分支；成功记录兼容，并不否定失败路径原缺陷。

代码与测试、逐次原始日志、原始/修后 outcome、重试及封存观察均在 copy-index.json 白名单。MONEY 原子发布 helper/caller 的交叉复核仅静态，无该范围阻塞；未冒称独立重跑其8项。
