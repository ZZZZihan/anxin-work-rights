# 默认清理模式补充

原 3e5 作者 fixture 的保留目录模式没有执行 rm，掩盖了默认 CI 中 after-hook 注册顺序：rm 先于 lifecycle release，出现 ENOENT。ROOT 实际 46P1F 原日志已留，作者也在默认无保留模式定向真实复现 0P1F。此为测试清理缺陷，不是 run 协议失败。

最终只改作者 fixture 的单一清理 hook：先 release 并等待本测试 worker 收尾，再删除自有临时树；17 条原行为断言没有改变。无 retain 环境的 Node24.22 和 Node26.11 各 17P，lint/syntax P。run 仍为 dab72；test 最终 87db0eb5。原收据/索引/3e5 源快照均保留，本补充优先于旧文中的 final test 标记。

复制用 copy-index.final.json；原 copy-index.json 不覆盖，不整树复制生成的 worker 或可执行证据。
