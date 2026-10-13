# 合成材料识别样例

这些文件全部由 `generate.swift` 生成，仅用于软件识别测试。公司、劳动者、工资与聊天内容均为虚构，不是银行流水、劳动合同原件或实际聊天记录，不具有法律效力。

- `contract.png`、`contract.pdf`：合成星海科技有限公司、张小合、设备维护员、入职日期 `2026年01月05日`、月工资 `8000元`。
- `wage-statement.png`：合成到账记录，付款日期 `2026年02月10日`、到账金额 `6500元`。
- `chat.png`：合成上班管理安排和欠薪陈述。
- `facts.txt`：合同样例的 UTF-8 文字对照。
- `over-limit.pdf`：6 页合成 PDF，识别服务应返回 `PDF_PAGE_LIMIT`，不得静默只处理前 5 页。

在 macOS 本机重新生成：

```sh
swift fixtures/material-demo/generate.swift fixtures/material-demo
```

图像中的原文是字段出处的校验依据。模型或 OCR 运行通过不代表对真实合同、银行流水、截图真伪或证据效力的判断。
