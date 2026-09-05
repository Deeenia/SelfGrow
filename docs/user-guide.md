# SelfGrow 用户使用说明

## 1. SelfGrow 做什么

SelfGrow 把零散信息分成两层：

- `Raw/`：保存原始证据，分为 `Project`、`Skill`、`Experience`。
- `Wiki/`：保存经过人工选择和沉淀的长期知识。

收集与筛选相互独立：先快速收集，再决定哪些内容值得进入 Wiki。

## 2. 安装

### 2.1 从源码构建

```bash
npm ci
npm run build
```

把以下三个文件复制到 `<Vault>/.obsidian/plugins/selfgrow/`：

```text
main.js
manifest.json
styles.css
```

然后在 Obsidian 中打开：

```text
设置 → 第三方插件 → SelfGrow → 启用
```

更新插件后需要完全退出并重新打开 Obsidian，单纯刷新笔记不会重新加载插件代码。

### 2.2 多设备的重要约束

桌面端和移动端必须打开同一个物理文件夹作为 Vault。名称相同不代表是同一个 Vault。

例如两端都应打开同一个同步目录：

```text
<shared-storage>/MyVault
```

不要在桌面端打开同步目录的父文件夹、移动端却打开其中的子文件夹。正确情况下，两端文件列表都会直接显示 `Raw`、`Wiki` 等根目录。

`.obsidian` 配置可随 Vault 同步，但 SecretStorage 密钥可能需要在每台设备上重新保存并测试。

## 3. 初始设置

进入 `设置 → SelfGrow`：

1. **根目录**：默认是 `Raw`。可以填写已有目录，也可以点击“新建 / 使用文件夹”。
2. **语言**：选择简体中文或 English，影响 README 选择、标题和筛选预览。
3. **聊天生成**：选择 OpenAI、DeepSeek、Qwen、Kimi 或 Custom，填写服务地址、模型和 SecretStorage 密钥，然后测试连接。
4. **内容提取**：默认使用本地文章提取。只有需要第三方平台解析时才启用 TikHub 或 Custom，并确认第三方数据传输提示。

AI 标题与筛选预览需要有效的聊天生成配置。密钥不可直接写在普通文本框或笔记中。

## 4. 收集内容

打开命令面板，执行 `SelfGrow: Open queue`，或从 SelfGrow 界面进入“收集”。

可提交：

- 单个 URL；
- 带宣传文案的平台分享文字，SelfGrow 会只提取 URL；
- GitHub 完整 URL；
- `owner/repo`；
- 仓库名或 Skill 名，确认候选仓库后继续；
- 正文文本；
- 多张图片；
- PDF、Markdown 和其他本地附件。

链接框和正文框用途不同：链接框只负责识别链接，不会把去除链接后的宣传文字自动写入正文。

提交前可以：

- 修改 AI 建议标题；
- 查看筛选预览；
- 在 `Project`、`Skill`、`Experience` 之间调整分类；
- 选择已有 Raw 子目录或新建目录；
- 对仓库搜索候选进行确认、收回或跳过。

### PDF 与 Markdown

- 支持带文本层的 `.pdf`、`.md` 和 `.markdown` 文件。
- 扫描版 PDF 没有可读取文本层时，需要先通过其他工具完成 OCR。
- 选择 AI 总结时，界面会显示接收服务商与模型，并要求本次明确授权。
- 未授权 AI 总结时，文档作为直接材料保留，不会把文档正文发送给 AI 服务。

## 5. GitHub 内容

GitHub 来源按以下顺序处理：

1. 识别仓库 URL；
2. 获取目标语言 README；
3. 保留原始 Markdown 结构；
4. 将相对链接和图片转换为可访问的绝对地址；
5. 生成独立的 AI 标题与筛选摘要；
6. 将完整 README 放在“提取正文”中渲染。

如果只输入仓库名，SelfGrow 需要访问 GitHub Search API。网络不可用或受到限流时，改用完整 URL 或 `owner/repo`。

## 6. 筛选与 Wiki

执行 `SelfGrow: Open knowledge review / 打开知识筛选`：

1. 选择 Raw 卡片；
2. 查看标题、摘要、正文和附件；
3. 标记需要沉淀的内容；
4. 由 Wiki 工作流生成或更新关联页面；
5. 确认结果后保留 Raw 作为来源证据。

不要直接删除 Raw 分类目录。即使目录暂时为空，它们仍用于区分沉淀类型。

## 7. 阅读与图谱

GitHub README 和复杂 Markdown 应使用 Obsidian“阅读视图”。桌面端可按 `Ctrl + E` 在编辑视图和阅读视图之间切换。

推荐关系图谱只显示 Wiki：

```text
path:"Wiki"
```

需要追溯来源时再使用：

```text
path:"Wiki" OR path:"Raw"
```

## 8. 常见问题

### 桌面和移动端目录不同

检查两端打开的 Vault 绝对路径，而不是 Vault 显示名称。不要把同一个 Vault 的父目录和子目录分别打开。

### 更新后界面还是旧的

完全关闭 Obsidian，再重新启动。移动端需要从任务切换器中结束应用。

### Markdown 源码直接显示

切换到阅读视图。若图片仍失败，检查图片 URL 是否能在系统浏览器打开。

### 仓库名搜索不到，但 URL 可以

GitHub Search API 可能不可达或受到限流。优先输入完整 GitHub URL 或 `owner/repo`。

### AI 标题或摘要没有生成

在 SelfGrow 设置中重新保存当前设备的 SecretStorage 密钥，并执行“测试连接”。失败的记录会保留在队列中，不应静默保存为完成状态。

### 同一 URL 被拒绝

SelfGrow 会阻止重复 URL。先在 Raw 中查找现有卡片；需要重新测试时，处理或移除现有记录后再提交。

## 9. 数据与隐私

- Raw、Wiki、附件和设置保存在当前 Vault。
- 本地文章提取不需要把正文发送给第三方提取服务。
- 启用第三方提取时，界面会明确提示可能发送的 URL 和服务标识符。
- AI 标题、预览、推荐度和文档总结会把所需来源材料发送给用户配置的模型服务；文档总结仅在用户对本次收集明确授权后进行。
- GitHub 仓库解析会访问 GitHub API、仓库页面或 Raw 内容地址；YouTube、Bilibili 及用户启用的第三方提取服务可能接收相应链接。
- 平台密码和 Cookie 不会自动发送。
- SelfGrow 不包含客户端遥测，也不运营 SelfGrow 账户或服务器。
