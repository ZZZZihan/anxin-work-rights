# README 界面截图

这组图片于 2026-10-13 从当前演示站的真实浏览器页面重新截取，展示深蓝主色与浅彩卡片的工作台界面。画面中的用户、单位、案件与材料均为合成演示数据。PNG 是浏览器直接输出，未改色、拼接或替换页面内容。

## 来源与版本

- 截图入口：`http://172.23.1.127/`（局域网演示站）。
- 界面版本：`7e3d496f56a81de6fe535432d598517b5e618121`，分支 `feature/workspace-pastel`，对应[界面 PR #19](https://github.com/ZZZZihan/anxin-work-rights/pull/19)。
- 截图前后读取 `/api/ready`，均返回 `status=ok`、上述 `release`、`persistentDemo=true`。
- 浏览器：Chromium / Playwright；操作限于页面导航和切换当前案件，未上传、删除或修改服务端业务数据。

| 图片 | 截图时间（北京时间） | 浏览器视口 | 展示内容 |
| --- | --- | --- | --- |
| [行动首页](workbench-home-7e3d496.png) | 2026-10-13 12:19:34 | 1440 × 1000 | 案件概况、优先处理事项、案件列表与快捷入口 |
| [证据管家](workbench-evidence-7e3d496.png) | 2026-10-13 12:20:38 | 1440 × 1200 | 劳动关系确认演示案件的文件入口、材料类别、来源说明与两份材料记录 |

## 展示范围

这组图片用于展示当前演示站的界面。材料识别与公开资料检索样例位于另一个分支 `feature/material-source-demo`，对应[功能 PR #24](https://github.com/ZZZZihan/anxin-work-rights/pull/24)。截图时两条分支尚未整合，因此本组图片不作为材料识别或模型功能已在新版界面部署的证据。

材料字段、OCR 原文定位与模型输出的历史运行截图仍保存在 [docs/validation](../validation/README.md)，保持原文件与原报告不变。

## 文件校验

```text
91bb2d21bceacfdb0ad7881131649934b24159018b6708f7f63f871e0fd22ceb  workbench-home-7e3d496.png
73e15edba7dc58cc7738cea9cec99f1b8dc92fa65fd4bc7125cde9ca619abc62  workbench-evidence-7e3d496.png
```
