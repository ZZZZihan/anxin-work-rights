# 结果清单原子发布：固定 a8d0 分诊与修复

确认为真实故障路径。原 `verify.mjs:250` 直接以 `wx` 写入正式清单，native 文件大小限制使写入返回 `EFBIG`，正式路径残留128/7433字节且无法解析；取消限制后重试仍 `EEXIST`。正常首次写入与禁止二次覆盖控制成立。该复现仅抽取精确发布语句，未执行预检、评分器、历史CLI或模型。

现有冻结结果未见损坏：首跑清单仍为固定 `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`，原60文件、当前109代码、v30四产物、v29归档106均逐SHA匹配；原始复现期间284路径前后字节一致。

修复仅增加通用 `publishImmutableFile(destination, bytes)`，同目录独占stage完整写入、sync和close后用hard link发布，既有目标不覆盖。发布前失败保留stage且正式路径不存在；发布成功后的unlink失败单列published回执，不撤销成功状态。verify只在写分支附带publication回执，readonly返回形状与checkOutcome原文不变。

同八项锁定测试：固定a8d0为2P6F，Node24.22与Node26.11修后各8P。覆盖native部分写入及无占名重试、完整stage可见性、sync失败、write+close主错保留、已发布cleanup错误、并发唯一winner和既有符号链接不覆盖。三文件scoped ESLint及verify语法检查通过。故障adapter仅在隔离测试子进程，不是产品的额外注入接口。

P1递归复制仅CI缓解：a8d0 workflow先完整静态检查，再暂存唯一postfreeze-evidence目录，历史检查和npm check原命令保留，always恢复。直接CLI的withFrozenCode/withCorrectionV29Code仍cp整个experiments；本补丁不声称修复通用复制性能。

不改旧冻结/快照/数据/原始输出。未运行完整预检/评分器/重历史链/HTTP/模型/CI。硬链接原子可见性不等同硬件断电持久性；未执行SIGKILL。请求Sol ultra，实际后端未独立核验。其他Agent技术复核另行出据，不等同人工业务验收。
