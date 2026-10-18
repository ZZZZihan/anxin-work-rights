# ROUND18 金额作者自检

固定基线为 CODE git 9b4bba2fbc85ccd2a7cd8003a2d4a1f2e0593207，真实归档路径及哈希见 baseline.json。产品只修改 OWN lib/material-money-v4.ts；新测试 scripts/material-facts-v7-round18-money-author.test.mjs。未修改旧测试、共享 currency/source 文件或历史实验。

中文小写整数元与 ASCII/既有中文单数字角分共用 BigInt 精确分值，零桥只准省略角时引入非零分。财务大写整数元复用冻结 normalizeMoneyValue 对整元部分的 canonical 校验，再合成角分；异常完整写法不回退成旧 parser 的片段。金额 token 未改，原 rawValue、matchedText、code-point span 和 representation 不改。新支持不自动升级历史不可用金额；错误历史派生值只降为 null。

候选使用 matched span 后的 value 剩余和完整 quote 后缘识别显式 /／ 费率。连续 Unicode 字母/汉字单位不在既有枚举内则 unsupported/null；只保留既有 month/day/hour/piece 枚举。有限每+已知单位亦受守护，数字除数仍交原算式守护。检测副本只 NFKC、去格式字符及横向空白折叠，原文和位置不修写。受支持单位保持既有紧随后文兼容，故此处并未声称任意自然语言词界都已穷尽。

同一 final193 自动集在固定9b旧版本为69通过/124失败，OWN最终版本193通过；旧 mixed-subunits191通过。旧485金额+47运行时回归实际529通过/3失败，3项为此次授权新增的合法混合写法旧 unsupported 契约：四元五角伍分→4.55、一千万元伍分→10000000.05、伍仟元五角→5000.50。ROOT负责迁移；作者未改旧测试。scoped ESLint exit0。原始失败日志保留，不将中间180集的作者财务数字拼写错误当产品缺陷。

作者自检覆盖 full literal、full quote、短 quote 由完整 source 守护、裸数字裁剪、历史强制 exact、历史不可用不升级、raw/Unicode位置、支持枚举费率和另一事件对照。这里的source证据使用固定9b共享依赖；ROOT后续传统别名补丁、独立评审、完整构建与HTTP由主侧另行整合验证。作者未运行模型、训练、部署、提交、推送或原冻结重写。
