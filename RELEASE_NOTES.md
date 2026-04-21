# Anything Analyzer v3.5.2

## 修复

- **macOS 自动更新签名校验失败** — 修复 mac 发布链路中更新包签名/校验缺失的问题，避免 `ShipIt` 在更新时提示“代码对象根本未签名”并导致新版本无法正确安装
- **AI / MCP 多轮追问上下文丢失** — 修复重新分析后聊天历史未正确重置、MCP 追问缺少初始上下文的问题，提升继续追问时的分析准确性
- **聊天失败状态残留** — 发送追问失败时会回滚乐观插入的用户消息，避免 UI 中残留无效消息

## 改进

- **长对话工具上下文压缩** — 自动剥离和压缩旧消息中的工具上下文，保留关键请求序号与核心发现，降低长会话上下文膨胀问题
- **报告显示与导出优化** — 前端显示与导出报告时自动隐藏内部 `tool_context` 标记，使内容更干净、更适合分享
- **macOS 发布稳定性增强** — 单次 mac 构建同时产出 x64 与 arm64 更新元数据，并在 CI 中校验 `latest-mac.yml` 与 `codesign`，避免架构元数据被覆盖

## 下载

| 平台 | 文件 |
|------|------|
| Windows | `Anything-Analyzer-Setup-3.5.2.exe` |
| macOS (Apple Silicon) | `Anything-Analyzer-3.5.2-arm64.dmg` |
| macOS (Intel) | `Anything-Analyzer-3.5.2-x64.dmg` |
| Linux | `Anything-Analyzer-3.5.2.AppImage` |
