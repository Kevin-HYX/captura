# 本仓库是通用网页流程采集器，不是 Ligentia 子系统

拆仓时要决定开源范围。代码本来就不执行业务自动化；`create-plugin-from-record` 依赖 Ligentia 的 Flow Package、`.agent` 原则和 `plugins/` 目录。

决定：本仓库只包含 Chrome/Edge 扩展（Static Annotation、Dynamic Record、ZIP 导出）和 `dynamic-raw-reader`。Flow Package、plugin 生成、Sidebar、买方/卖方/平台模型留在 Ligentia；Ligentia 以后消费 Captura 的 Evidence Package。

## Considered Options

- 通用网页流程采集器 Captura（采纳）
- 把 `create-plugin-from-record` 一并带走，仍按「给 Ligentia 产 plugin」来写
- 做成带 replay / 脚本生成的自动化工具箱
