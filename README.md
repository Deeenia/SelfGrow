# SelfGrow

SelfGrow 是一个本地优先、兼容桌面端和移动端的 Obsidian 插件，用于把链接、平台分享文本、正文、图片、本地文件和 GitHub 仓库整理为可筛选的 Raw 卡片，并进一步沉淀为 Wiki 知识。

> 当前处于私有协作与兼容性调试阶段，不作为公开稳定版本发布。

## 核心流程

```text
收集内容 → 提取正文/README → AI 标题与筛选预览
        → Raw/Project | Raw/Skill | Raw/Experience
        → 人工筛选 → Wiki 沉淀与双向链接
```

- 支持从整段平台分享文字中提取 URL。
- 支持直接输入 GitHub URL、`owner/repo` 或仓库/Skill 名称。
- GitHub 来源会优先选择目标语言 README，并保留可渲染的 Markdown 图文。
- AI 负责分类建议、关键词标题和筛选摘要；正文证据保持完整。
- Raw 与 Wiki 都保存在用户 Vault 中，目录可配置且不会自动删除旧目录。

## 文档

- [用户使用说明](docs/user-guide.md)
- [开发者使用说明与安卓兼容指南](docs/developer-guide.md)
- [产品规格](docs/product-spec.md)
- [系统架构](docs/system-architecture.md)
- [API 契约](docs/api-contracts.md)
- [设计系统](docs/design-system.md)

## 本地开发

需要 Node.js 20+、npm 11+ 和 Obsidian 1.13+。

```bash
npm ci
npm run check
```

生产构建生成根目录下的 `main.js`。安装时将以下文件复制到：

```text
<Vault>/.obsidian/plugins/selfgrow/
├── main.js
├── manifest.json
└── styles.css
```

完整开发流程见[开发者使用说明](docs/developer-guide.md)。

## 隐私与仓库边界

- API 密钥通过 Obsidian SecretStorage 保存，不得写入源码、文档或提交记录。
- `Raw/`、`Wiki/`、Vault 配置、iCloud 恢复文件和本机调试目录不属于本仓库。
- 项目当前为私有仓库，`package.json` 使用 `UNLICENSED`，未经所有者许可不得公开分发。
