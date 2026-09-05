# SelfGrow

[English](README.md) | 中文

[项目官网](https://deeenia.github.io/SelfGrow/) · [下载最新版](https://github.com/Deeenia/SelfGrow/releases/latest) · [完整用户指南](docs/user-guide.md)

SelfGrow 是一款本地优先的 Obsidian 插件。它把链接、分享文本、图片、PDF、Markdown 文档和 GitHub 仓库整理成可审核的 Raw 卡片；由你决定哪些内容值得保留，再选择是否将它们沉淀为彼此关联的 Wiki。

## 功能

- 收集网址、分享文本、直接笔记、图片和本地附件。
- 提取 `.pdf`、`.md` 和 `.markdown` 文件中的可读文本。
- 在当前 Vault 中保留完整的来源证据与附件。
- 使用你配置的 AI 服务生成标题、摘要、分类，以及可选的偏好推荐分数。
- 在桌面端和移动端审核 Raw 卡片，再决定是否进入 Wiki 沉淀流程。
- 识别 GitHub 仓库，并保留 README 中的 Markdown、链接、图片、表格和代码块。
- 通过内置的 `selfgrow-wiki` Agent Skill 先展示沉淀方案，只有得到明确批准后才写入 Wiki。

## 使用要求

- Obsidian 1.13.0 或更高版本。
- 支持桌面端、iOS 和 Android；SelfGrow 不依赖 Node.js 或 Electron 运行时 API。
- 仅 AI 辅助功能需要 API Key；不配置 AI 也能使用本地收集与存储。

## 安装

SelfGrow 进入 Obsidian 社区插件目录后：

1. 打开 **设置 → 第三方插件 → 浏览**。
2. 搜索 **SelfGrow**。
3. 点击 **安装**，然后 **启用**。

如需手动安装，请从对应的 [GitHub Release](https://github.com/Deeenia/SelfGrow/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入：

```text
<Vault>/.obsidian/plugins/selfgrow/
```

安装或更新后重启 Obsidian。

## 快速开始

1. 打开 **设置 → SelfGrow**，选择 Raw 根目录和界面语言。
2. 如需自动标题、摘要、文档总结、图片理解或推荐分数，请配置 AI 服务。
3. 运行 **SelfGrow: Open queue** 收集资料。
4. 运行 **SelfGrow: Open knowledge review**，审核、分类、选择或删除 Raw 卡片。
5. 使用 `selfgrow-wiki` 时，先检查它提出的 Wiki 修改方案，确认无误后再明确批准写入。

更完整的说明请阅读[用户指南](docs/user-guide.md)。

## PDF 与 Markdown 文档

- 支持 `.pdf`、`.md` 和 `.markdown`。
- PDF 需要包含可用的文本层；纯扫描 PDF 目前需要先通过外部 OCR 识别。
- 将文档文本发送给已配置的 AI 服务前，SelfGrow 会请求明确授权。
- 如果不同意发送，文件仍会作为直接资料保留，但不会由 AI 总结。

## 隐私与网络访问

SelfGrow 没有客户端遥测，也不运营 SelfGrow 账号或服务器。Raw 卡片、Wiki 页面、附件、偏好和插件设置都保存在当前 Obsidian Vault 中。

只有用户主动启用或发起相应功能时，SelfGrow 才会访问网络：

- **AI 服务：** OpenAI、DeepSeek、Qwen、Kimi，或自定义 OpenAI 兼容接口。来源节选、经授权的文档文本、被选中的偏好信号，以及启用视觉处理时的图片，可能发送到所配置的服务。API Key 通过 Obsidian SecretStorage 引用。
- **GitHub：** 使用 GitHub API、仓库页面和原始内容地址识别仓库并读取 README。
- **平台元数据：** 支持的 YouTube 与哔哩哔哩链接可能访问其公开接口。
- **可选提取服务：** 仅在用户主动启用并接受应用内说明后，才会使用 TikHub 或自定义提取接口。

SelfGrow 不会向这些服务发送浏览器 Cookie、平台密码、Vault 路径、无关笔记或来源项目记录。启用服务前，请自行阅读对应服务的条款与隐私政策。

## 开发

需要 Node.js 20+ 和 npm 11+。

```bash
npm ci
npm run check
```

生产构建会生成 `main.js`。CI 使用同一条检查命令完成格式、Lint、测试、类型检查和生产构建。

## 许可证

SelfGrow 采用 [MIT License](LICENSE)。第三方依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，项目贡献者见 [CONTRIBUTORS.md](CONTRIBUTORS.md)。
