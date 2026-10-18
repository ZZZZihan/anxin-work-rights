ROUND14 作者交付说明

只修改 HTTP 回归运行器和本次测试，不改应用解析/评分、冻结数据、历史 snapshots、manifests 或结果。两个运行器统一使用 scripts/owned-http-process-group.mjs：创建时强制自有 detached group、立即监听 close；只向本 WeakMap 注册的 child/group 发信号。stdio 默认 ignore，传入 pipe 原样保留，所以 cancel 原有 UTF-8 日志捕获及脱敏不改。

POSIX 完成条件是 leader close 且组内无非 Z/X 成员，不再要求 kill(-pgid,0) 必须 ESRCH。查询仅收集 pid/pgid/stat，不收集命令/参数/环境；正常 pgid0 行合法。ps 非0、空输出、不可解析或超时均为清理失败，仍尝试向自有 group 发送 SIGKILL，并保留原查询错误。TERM/KILL 两阶段各有 5s 轮询预算，每阶段最多多一次 1s 查询加 500ms close 硬界；初始已关闭检查有相同独立查询上限。没有宣称精确 5s 总上限。Windows 保留仅 child.kill fallback，本次未在 Windows 执行，未声称 Windows 子树保证。

cancel 的 Worker 及 migration 均使用此生命周期；v7 migration 同样等待组结束。migration 原始失败与 stop_migration 清理失败分别保存；单独清理失败会使流程失败并阻止继续启动 Worker。中途 restart stop_worker 失败也登记，最终即使再次清理成功仍保留现场。有任何 stop_worker/stop_migration 失败就跳过临时目录删除，cleanup.failures 新增 retain_temporary_resources 和私有目录路径；不输出目录内容或 token。保留原报告失败记录，不把不能查询当成无存活进程。

实际作者证据：Darwin 真实 Node launcher/后代及 loopback socket 两个旧 cancel 用例均失败（0/2），停止函数已返回但端口仍活；修复后最终字节 2/2 通过，检查后代 socket 关闭、端口可重新绑定、无非僵尸成员、无关 sibling 服务仍活。原有 v7 五项最终字节 5/5 通过。中间第一次 helper 的 5项结果3绿2红：把阶段尾部1ms误当 ps 查询预算导致正常 ps 被杀，已修复并保留原失败日志，不能把它混作原审查 Linux 复现。全部5文件语法/局部 lint 退出0，隔离任务树 React 自动检测警告已保留。

本机 Docker daemon 不可用，作者没有在 Linux 复现 PID1 不回收僵尸；独立 Agent 在授权 Linux 专用临时 fixture 上另做 subreaper 真实验证，结果另记，不能合并声称为作者执行。本作者没有启动完整 Worker HTTP、构建、模型、训练或部署，也没有提交/推送。主 Agent 统一执行四条真实 HTTP、全量检查和冻结结果只读复核。
