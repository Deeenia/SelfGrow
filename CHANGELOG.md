# SelfGrow Changelog

本文件记录项目从当前私有测试阶段开始的修改、验证和发布事件。
尚未发布的变更放在 `Unreleased`，正式打包后再移入对应版本号。

## [Unreleased] - 2026-08-19

### Added

- 新增 `.gitattributes`，强制文本文件在 Windows/macOS/Linux 上统一以 LF checkout。
- 新增 `release/` 与 `/SelfGrow-*.zip` 忽略规则，避免构建产物进入源码仓库和 lint。
- 在 `eslint.config.mts` 中忽略 `release` 目录。
- 新增本 Changelog 文件，用于持续记录修改与验证结果。

### Built

- 执行 `npm ci` 成功，安装 447 个依赖包。
- 2026-08-19：用户本机执行完整 `npm run check` 通过：
  - `format:check` 通过；
  - `lint` 通过；
  - `vitest run`：34 个测试文件、267 个测试全部通过；
  - `typecheck` 通过；
  - 生产构建成功：`main.js` 523,367 bytes，gzip 126,424 bytes。
- 沙箱环境使用 esbuild 原生二进制等价构建通过，未发现 Node/Electron 禁用导入。

### Packaged

- 生成 `SelfGrow-0.1.0-android-test.zip`，内部结构：

```text
selfgrow/
 main.js
 manifest.json
 styles.css
```

- 安装目录同步到本地 Obsidian PC 测试 Vault：

```text
D:\ai_test\test\test\.obsidian\plugins\selfgrow\
```

### Verified on Obsidian PC

- [x] 2026-08-19：重启后插件出现在第三方插件列表并可启用。
- [x] 2026-08-19：`SelfGrow: Open queue` 可打开。
- [x] 2026-08-19：`SelfGrow: Open knowledge review / 打开知识筛选` 可打开。
- [x] 2026-08-19：SelfGrow 设置页可打开。
- 测试 Vault：`D:\ai_test\test\test`
- [x] 2026-08-19：插件文件已复制到同步测试 Vault `D:\ai_test\test_remote\test_remote\.obsidian\plugins\selfgrow\`，等待该 Vault 中手动启用。
- [x] 2026-08-19：通过文件时间线确认 Obsidian Sync 会同步插件生成的内容。`test` Vault 在 18:05 生成的 `SelfGrow.md`、`Wiki/Index.md`、`Wiki/Log.md` 于 18:05 出现在 `test_remote`。
- [x] 2026-08-19：通过本地文件状态推断，当前 Obsidian Sync 配置没有同步 `.obsidian/plugins` 目录。`test` 中已有的 `remotely-save` 和 `selfgrow` 插件目录均未自动出现在 `test_remote`，说明 Android 端仍需要手动安装插件本体。

### Pending

- [ ] 2026-08-19：用户在 Queue 粘贴整篇推文后，Inbox 显示 `waiting_ai_configuration`。需配置 Chat 服务后重试，验证文本 Raw 生成链路。
- [x] 2026-08-19：Android 端插件可被 Obsidian 识别。首次解压后文件名被解压/传输工具加入了 `selfgrow_` 前缀，修正为 `main.js`、`manifest.json`、`styles.css` 后恢复正常。
- [x] 2026-08-20：Android 端插件至少能正常启动，未发现启动级错误。
- [ ] Android：Queue / Review / 设置页可打开。
- [ ] Android：完全重启后插件仍处于启用状态。
- [ ] Android：可看到 PC 端通过 Obsidian Sync 同步过来的 `SelfGrow.md` 和 `Wiki/`。
- [ ] Android：核心兼容冒烟测试。
- [x] 2026-08-20：完成 iOS 静态兼容性排查：源码无 Node/Electron 导入；构建元数据中禁用导入为 0；`isDesktopOnly: false`；使用 Obsidian mobile-safe API；Review 含 Pointer/Touch 双事件处理；移动端不会主动初始化 Wiki 目录。
- [x] 2026-08-20：iOS 确认 Obsidian Sync 插件同步可用。
- [x] 2026-08-20：iOS `test_remote` Remote Vault 可同步得到 SelfGrow。
- [x] 2026-08-20：iOS 第三方插件列表可识别并启用 SelfGrow。
- [x] 2026-08-20：iOS Queue / Review / 设置页可打开。
- [x] 2026-08-20：iOS 完全重启后插件仍正常。
- [x] 2026-08-20：用户确认 iOS 端同步与运行正常。

## [Unreleased] - 2026-08-23

### Model provider & key management

- 新增 `unconfigured` 服务商初始状态，避免默认绑定错误服务商。
- 恢复使用 Obsidian 原生 `SecretComponent` 管理密钥。
- 选择/切换 SecretStorage 密钥时，清空旧的 provider 和 model，要求重新选择服务商。
- 模型列表加载前校验：服务商已选择、密钥已保存、SecretStorage 中存在有效 Key。
- 模型列表支持“手动输入其他模型”。
- 模型列表按服务商 curated 目录过滤和排序，避免 Qwen 列表混入 Kimi 模型。
- 更新当前推荐模型目录：
  - DeepSeek：`deepseek-v4-flash`、`deepseek-v4-pro`
  - Qwen：`qwen3.8-max`、`qwen3.7-plus`、`qwen3.7-flash`
  - Kimi：`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`、`kimi-k2.6`

### Chat connection test

- 连接测试超时从 10s 提高到 30s。
- Kimi 使用轻量 provider-compatible 探测参数。
- 支持 reasoning-only 响应和多模态 content array 响应。
- 移除依赖本地模型目录的图片探测逻辑。

### Multi-harness support

- Python guard 新增 `bootstrap` 命令。
- 新增 `docs/harness-compatibility.md`。
- 新增 `skills/selfgrow-wiki/BOOTSTRAP.md`。
- 新增 `docs/AGENTS.template.md`，并复制到测试 Vault。
- 已验证：
  - Codex
  - opencode
  - dsh
  - WorkBuddy Desktop

### Verification

- 当前未提交工作区验证通过：
  - `format:check`
  - `lint`
  - `typecheck`
  - 35 个测试文件，285 个测试全部通过

### Git status

- `feature/android-compat` 已推送到 `origin/feature/android-compat`。
- 该分支包含：
  - `64d0312 chore: enforce LF line endings on Windows checkouts`
  - `afbad02 chore: ignore generated release artifacts`
  - `f2cc819 docs: add changelog for test build and verification`
- 本地 `main` 仍领先 `origin/main` 两个提交，暂不直接推送 `main`。
- 协作者 UI 分支已在 `origin` 出现：`feature/ui-stabilization`。
