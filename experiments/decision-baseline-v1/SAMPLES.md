# 安薪乐业样本审阅

以下全部为由 Agent 按任务约束编写的合成场景，来自 train 划分；不是真实咨询、公开案例原文、人工专家标注或法律结论。本文件用于审阅，不会触发训练。

## 样本 1：missing_due

标识：`c_b3c74fc5cb07`；组：`g002`。

**user**：我核算2026年4月1日到5月31日，约定月薪6000元。这段期间一分钱工资都没收到。

目标输出：

```json
{
  "missing": [
    "agreed_due_total"
  ],
  "conflicts": [],
  "next_action": {
    "type": "ask_user",
    "questions": [
      {
        "field": "agreed_due_total",
        "text": "这段期间双方确认的应发工资总额是多少？"
      }
    ],
    "tool": null,
    "arguments": null
  }
}
```

月薪是标准，未明确确认两个月期间应发总额，不能自行乘二。

## 样本 2：complete

标识：`c_800a106f2332`；组：`g001`。

**user**：食堂那份工，核算2026年3月4日至3月27日。应发合计8300元，工资只付了2000元，没有别的工资付款。

目标输出：

```json
{
  "missing": [],
  "conflicts": [],
  "next_action": {
    "type": "call_tool",
    "questions": [],
    "tool": "calculate_wage_gap",
    "arguments": {
      "period_start": "2026-03-04",
      "period_end": "2026-03-27",
      "due": 8300,
      "paid": 2000
    }
  }
}
```

明确的期间总额和全部工资实付可以直接调用计算。

## 样本 3：mixed_payment

标识：`c_8adc73f59388`；组：`g005`。

**user**：2026年7月1日至7月15日应发工资总额5100元。一共只收到一笔2200元，里面含工资和出差报销，我还不知道各占多少。

目标输出：

```json
{
  "missing": [
    "wage_paid_total"
  ],
  "conflicts": [],
  "next_action": {
    "type": "ask_user",
    "questions": [
      {
        "field": "wage_paid_total",
        "text": "这段期间实际已付的工资合计是多少，是否已包括全部工资付款？"
      }
    ],
    "tool": null,
    "arguments": null
  }
}
```

合并转账未拆分工资和报销。

## 样本 4：conflict

标识：`c_553091b9b7c2`；组：`g006`。

**user**：核算2026年8月1日至8月31日。主管给我的应发总额是9000元，财务对同一段写9500元，两边还没对清。工资实际全部付款合计5000元。

目标输出：

```json
{
  "missing": [],
  "conflicts": [
    "agreed_due_total"
  ],
  "next_action": {
    "type": "ask_user",
    "questions": [
      {
        "field": "agreed_due_total",
        "text": "这段期间双方确认的应发工资总额是多少？"
      }
    ],
    "tool": null,
    "arguments": null
  }
}
```

两份尚未协调的期间应发数互相冲突。

## 样本 5：multi_turn

标识：`c_8742b41b2f1b`；组：`g006`。

**user**：2026年8月1日至8月31日，应发共9000元，全部工资已付5000元。

**assistant**：收到这些信息。

**user**：我刚才把应发总额打错了，更正为9500元，9000元作废；其它信息没变。

目标输出：

```json
{
  "missing": [],
  "conflicts": [],
  "next_action": {
    "type": "call_tool",
    "questions": [],
    "tool": "calculate_wage_gap",
    "arguments": {
      "period_start": "2026-08-01",
      "period_end": "2026-08-31",
      "due": 9500,
      "paid": 5000
    }
  }
}
```

用户明确作废旧数，按9500元确认，不保留伪冲突。

## 样本 6：tool_failure

标识：`c_fb9cef57033e`；组：`g011`。

**user**：2026年3月1日至3月9日应发合计2600元，全部工资已付600元。

**assistant**：刚才的计算请求已连续两次超时。

工具状态：`{"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}`

目标输出：

```json
{
  "missing": [],
  "conflicts": [],
  "next_action": {
    "type": "report_tool_failure",
    "questions": [],
    "tool": null,
    "arguments": null
  }
}
```

工具状态已达到两次重试上限，应报告失败。
