# SelfGrow 开发者使用说明

## 1. 开发目标

SelfGrow 是 Obsidian 第三方插件，目标运行环境包括 Windows、iOS 和 Android。开发时必须保持：

- `manifest.json` 中 `isDesktopOnly: false`；
- 本地优先、Vault 内存储；
- 桌面端与移动端共享核心行为；
- 网络、AI 和同步失败均可恢复，不丢失用户输入；
- 不自动删除 Raw、Wiki 或用户自建目录。

## 2. 环境准备

需要 Node.js 20+、npm 11+、Obsidian 1.13+ 和 Git。

```bash
git clone <private-repository-url>
cd SelfGrow
npm ci
npm run check
```

## 3. 常用命令

```text
npm run dev           监听源码并重建 main.js
npm run format        格式化源码和配置
npm run format:check  检查格式
npm run lint          ESLint 与 Obsidian 规则检查
npm run typecheck     检查源码和测试类型
npm test              运行 Vitest 测试
npm run build         生成生产 main.js 和 build-meta.json
npm run check         执行全部质量门禁
```

提交前必须运行 `npm run check`，CI 会执行同一命令。

## 4. 目录结构

```text
src/
├── ai/          AI 连接与协议
├── domain/      领域模型、错误和路径类型
├── extraction/  网页、图片、平台和 Markdown 提取
├── github/      仓库搜索、README 选择与读取
├── inbox/       收集界面与队列
├── knowledge/   Raw 生成、筛选和提交
├── platform/    Obsidian 平台适配器
├── settings/    设置、SecretStorage 与连接测试
├── topics/      主题处理
├── url/         URL 识别与规范化
└── vault/       Vault 文件操作

tests/           与 src 对应的单元和集成测试
docs/            产品、架构、协议、设计和使用文档
skills/          SelfGrow 专用 Codex Skills
```

不要提交 `node_modules/`、`main.js`、`build-meta.json`、真实 Vault、API 密钥、iCloud 恢复数据或本机调试目录。

## 5. 处理链路

```text
Capture input
  → URL/share-text normalization
  → extractor routing
  → GitHub README or generic body extraction
  → Markdown normalization
  → AI recognition card
  → Raw commit
  → review selection
  → Wiki distillation
```

修复应放在所有调用方共享的最靠前入口。例如 GitHub Markdown 清洗必须覆盖 GitHub 专用提取器和 `generic_web` 回退路径，不能只修某个页面。

## 6. 本地安装和调试

执行 `npm run build`，把 `main.js`、`manifest.json`、`styles.css` 复制到：

```text
<Vault>/.obsidian/plugins/selfgrow/
```

完全重启 Obsidian。插件代码加载到内存后，覆盖 `main.js` 不会自动替换正在运行的版本。

开发时使用专用测试 Vault，不要用真实知识库做破坏性测试。任何迁移都必须提供前后数量、冲突报告和回滚路径。

## 7. Android 兼容开发

### 7.1 代码约束

- 不导入 Node.js、Electron、`fs`、`path`、`process`、`Buffer` 等桌面运行时 API。
- 文件操作只通过 Obsidian Vault/Adapter 和项目中的 `VaultPath`、路径守卫完成。
- 网络请求使用项目的 `HTTPTransport`/Obsidian 适配层，不依赖浏览器扩展或桌面 Cookie。
- 不依赖鼠标悬停、右键或固定窗口宽度；所有主要操作必须可触摸完成。
- 弹层和候选卡片必须可以关闭、返回，并适应软键盘和窄屏滚动。
- 使用 Obsidian Markdown 渲染能力；远程图片必须是可访问的绝对 HTTPS URL。
- SecretStorage 是设备级能力；不要假设桌面保存的密钥必然出现在 Android。
- 长任务必须显示状态并可重试，不得阻塞 UI 线程。

### 7.2 Android 回归清单

每个 Android PR 至少验证：

1. 全新 Vault 安装和现有 Vault 升级；
2. 收集/筛选按钮双向跳转；
3. 平台分享文字提取 URL，且宣传文字不进入正文；
4. GitHub 完整 URL、`owner/repo` 和仓库名三种输入；
5. 中文 README 选择、Markdown 标题/列表/代码/表格/图片渲染；
6. 多图片与本地文件选择；
7. Raw 目录选择、新建目录和用户目录显示；
8. AI 密钥缺失、鉴权失败、超时和无网重试；
9. 重复 URL、取消候选、跳过搜索和返回操作；
10. 同步完成后，桌面端读取同一笔记。

记录 Obsidian 版本、Android 版本、设备/模拟器、输入样例、预期和实际结果。兼容修复必须附测试或最小复现。

## 8. Git 协作

建议分支：

```text
main                     可运行、通过全部检查
feature/android-compat   安卓兼容功能
fix/<short-name>         单一缺陷修复
docs/<short-name>        文档修改
```

协作步骤：

```bash
git switch main
git pull --ff-only
git switch -c feature/android-compat
# 修改并测试
npm run check
git add <明确文件>
git commit -m "fix: improve Android compatibility"
git push -u origin feature/android-compat
```

通过 Pull Request 合并，不直接覆盖他人的工作。PR 应说明：问题、根因、改动、验证设备/命令、残余风险和截图。

## 9. 测试原则

- 解析器、路径、状态机和错误分支必须有自动化测试。
- 修 Bug 时先加入能复现问题的最小测试，再修改共享入口。
- 网络测试使用 `FixtureHTTPTransport`，不让单元测试依赖真实 GitHub 或 AI 服务。
- 随机过程必须使用明确种子。
- 目录迁移、扫描、去重和过滤必须报告前后数量，不静默改变用户数据。

## 10. 发布检查

```bash
npm ci
npm run check
```

确认：

- `manifest.json`、`package.json` 和 `versions.json` 版本一致；
- 生产 `main.js` 构建成功；
- `main.js`、`manifest.json`、`styles.css` 可在干净 Vault 启用；
- 桌面、iOS、Android 至少各完成核心冒烟测试；
- 仓库和构建包不包含密钥、用户 Vault 或本机绝对路径。

当前项目为私有协作状态，不创建公开 Release，除非仓库所有者明确批准。
