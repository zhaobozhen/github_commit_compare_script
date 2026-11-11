# GitHub AI Changelog

一个零构建单文件 Tampermonkey / 油猴脚本：在 GitHub 仓库页面提供入口，对比任意两个 Commit、Tag 或分支，并调用用户自行配置的 AI 服务生成人类可读的变更日志。

## 功能特性

- **仓库页集成入口**：自动挂载到仓库头部操作栏（`AI Changelog`），容器不可见时退化为右下角浮动按钮，同时注册油猴菜单命令；支持 GitHub Turbo SPA 路由切换。
- **任意范围对比**：自动加载仓库 Tags 与分支供快速选择，支持手动输入任意 Commit SHA；位于 `/compare/{base}...{head}` 页面时自动预填起止版本。
- **多 AI 服务配置**：支持配置多个 OpenAI 兼容接口（OpenAI、DeepSeek、OpenRouter、本地 Ollama 等）与 Anthropic Messages 接口（Claude），支持连通性测试与实时切换。
- **内置免费层一键预设**：内置 `OpenRouter (Free)`（`openrouter/free`）、`Google Gemini`（`gemini-3.8-flash`）、`Groq`（`llama-3.3-70b-versatile`）、`硅基流动 (Free)`（`Qwen/Qwen2.5-7B-Instruct`）及本地 `Ollama` 一键预设，填入免费注册的个人 Key 即可使用。
- **大变更预算裁剪与截断提示**：自动过滤锁文件（`package-lock.json`、`pnpm-lock.yaml`、`Cargo.lock` 等）、压缩产物及二进制文件，按字符预算公平分配源码 Diff；超大型范围支持切换「仅基于 Commit 摘要」，并在超出 GitHub Compare API 单次上限（250 commits / 300 files）时显式提示。
- **固定结构化输出框架**：通过 JSON 契约约束 AI 输出并校验 Commit SHA 真实性，流式预览与最终导出统一编译为包含概览、6 大固定分类（破坏性变更 / 新增功能 / 问题修复 / 性能优化 / 重构整理 / 文档与构建）及数据范围说明的标准 Markdown。
- **Shadow DOM 隔离与安全渲染**：自适应 GitHub 明暗主题；通过 AST 安全构建 DOM 节点渲染 Markdown（不使用 `innerHTML`），支持原文切换、一键复制与按仓库/版本范围缓存结果。

## 安装与使用

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge MV3 用户需在 `chrome://extensions` 中打开 Tampermonkey 详情页，开启 **「允许用户脚本 / Allow User Scripts」** 开关）。
2. 新建脚本并导入 [github-ai-changelog.user.js](./github-ai-changelog.user.js) 的全部内容，保存启用。
3. 打开任意 GitHub 仓库页面，点击顶部操作栏或右下角的 `✦ AI Changelog` 入口打开抽屉。
4. 首次使用点击右上角「设置」→「+ 添加 AI 服务」，填写或使用预设（`OpenRouter (Free)` / `Gemini` / `Groq` / `硅基流动 (Free)` / `OpenAI` / `DeepSeek` / `Claude` / `Ollama`），填入对应 API Key（本地 Ollama 可留空）后点击「测试连接」验证。
5. 返回对比视图，指定 `Base` 与 `Head`（Commit SHA、Tag 或分支名），点击「生成变更日志」。

## 可选 GitHub Token 说明

- 公开仓库无需配置 GitHub Token 即可使用（受 GitHub 未认证 REST API 每小时 60 次限流约束）。
- 若需访问私有仓库或突破限流，可在脚本设置页填写仅具备只读权限（如 Fine-grained PAT `Contents: Read-only`）的 GitHub Token。
- 所有 AI API Key 与 GitHub Token 仅保存在浏览器本地油猴存储（`GM_setValue`），仅向 GitHub API 与你配置的 AI Endpoint 发起请求。

## 本地测试

需要 Node.js（已验证于 Node v26）：

```bash
node --test github-ai-changelog.test.js
```
