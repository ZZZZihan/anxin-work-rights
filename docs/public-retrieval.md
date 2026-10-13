# 公开资料检索接入

`lib/public-retrieval.ts` 是服务端纯计算模块，导出 `searchPublicKnowledge(query, { topic?, limit? })` 和 `getPublicKnowledgeRecord(id)`。客户端只导入 `lib/public-retrieval-types.ts` 中的类型，不导入检索模块或生成索引。模块不调用远程服务，不读取用户数据库或文件，不执行上传文本。

索引由 `python3 -B scripts/build-public-index.py` 从固定公开交付库生成；`python3 -B scripts/build-public-index.py --check` 只读核查生成物是否一致。生成前运行原始公开库核查，随后复查 JSONL SHA-256、引用闭包和条文原文，验证通过后原子替换唯一生成物。只收录 release 中的 14 个案例和 54 条文；公开来源全文中其他历史条款不进入检索。

查询最多支持 60000 字，与完整分析材料上限一致；超长时抛出明确的 RangeError，不截断材料。查询先移除 URL、邮箱，再从有限劳动权益词表识别概念并展开同义词。姓名、公司名、账号、金额及任意自由词不会作为检索词。返回 `query` 是识别出的法律概念展示字符串，不能用于还原原材料；`expandedTerms` 是固定词表的检索术语。排序采用标题、标签、证据描述和正文权重，并交替展示有实际命中的案例和条文；明确 topic 限定主题，limit 默认 6、限制 1..20。没有相关概念或没有实际匹配时返回空 hits。指定条文号时，该条文号必须出现在选定记录里。

命中提供固定 record ID、原文摘录 summary、实际命中术语及完整来源段落引用。summary 可能截短，完整文字可在 citations 查看；它不是模型生成事实。资料是典型案例汇编，案例含劳动关系不成立结果，不提供案件胜率。所有引用原文来自固定 sources JSONL，网页日期和采集时间不等于裁判日期。

条文的 versionNote 严格保留源记录 status_note；effectiveOn/expiresOn 为 null 时表示没有记录或未核实，不表示现行有效。已明确废止的司法解释（一）第三十二条第一款不进入检索；其其他选条保留后续影响说明。案例 rule 关联保留版本未确认说明。该模块没有重新核查全部法律现行性或个案适用性。

生成物与每次检索结果带原公开数据库 fingerprint。后端接入上传提取链路前，调用方负责材料所有权核查；检索模块没有权限读取材料。页面应直接渲染段落文本，以 record ID 或 paragraph ID 作 key；不得将上传材料内的 URL 当作本模块引用来源。

验证覆盖真实自然中文检索、无关输入、原材料隐私字段、明确 topic/limit、真实反向案例、全部记录来源段落、选定条文集合与版本说明、生成物一致，以及引用/条文篡改拒绝。Worker 构建、上传与检索的隔离 HTTP 闭环和浏览器验收由整合版本执行。
