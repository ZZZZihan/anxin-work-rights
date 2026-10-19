# ROUND42：评分CLI报告不可变发布

固定ROOT `a8d0b70448a11e62c8b2abe1d02298a3e4d3c04e` 的 `assess.mjs` 仍以普通writeFile写目标。真实CLI在目标已存在时退出0并覆盖报告，也沿符号链接改写指向文件。原生128字节文件上限使正式报告留下截断JSON。初始失败和128字节原件完整保留在本目录。

仅将CLI发布改为动态导入既有R41 helper，库/评分函数未改。完整stage写入、sync、close后以link原子且不覆盖发布；失败stage保留，重试用新stage；发布后unlink失败显式报告published状态。正常stdout摘要格式不变。库fixture无需publication helper。

同一8项作者测试：固定旧代码2通过6失败；修复后Node24.22及Node26.11各8通过。两个文件syntax及ESLint均退出0，ESLint零告警。额外永久CLI探针保留原覆写/符号链接/EFBIG及修后stage+retry原件。ROOT选定179条已绑定保护路径前后摘要一致。未运行模型、重历史链、真实holdout复评、完整检查或HTTP；没有ROOT/CODE写入、提交或推送。

两个交付文件及哈希见author.receipt.json与copy-index.json，helper沿用原2dad字节，不需重复覆盖ROOT。独立技术复核收据另计；本作者证据不替代业务验收。
