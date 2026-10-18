v27 准备完成，仅可复制以下白名单：准备根下 correction-code-v26/（97 snapshot + manifest）及 preparation-final.json 列出的六个工具/测试文件。不要整体复制准备根的支持目录。

实际检查：Node 26.11 合成桥接 7/7；真实 owned-temp 恢复 97 份后 callback 抛错，错误对象与清理均通过；六文件 syntax exit0、ESLint exit0（局部准备树缺 Next pages 的配置提示单列）。原 900000ms 共享绝对截止、cleanup reserve、policy、旧桥及固定摘要均不变；当前依赖并集100。

没有执行历史 CLI、评分器、两个 correction gate、write/check、HTTP、fullcheck 或模型。v27 尚未发布，不能将本准备记录当作真实复评或业务验收。DATA 的非实现者审查将单独交接。package/CI 仅建议小增量 patch，主侧应保留并行加入的测试。

初版版本标识匹配和两个准备脚本 namespace 重试诊断保留 initial-version-generation/，未运行历史链或发布。最终六文件 hash 已锁，不再自行扩改；如非实现者发现实质问题将另报。
