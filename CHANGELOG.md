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
- 模型目录鉴权、网络或协议失败时不再静默显示本地推荐表，设置页会保留真实错误，不再提示“已加载”。
- 新增“图片理解”能力开关：已知多模态模型自动开启，自定义模型可由用户明确启用。

### Visual cards & recommendation preferences

- 纯图片在当前模型支持图片输入时，通过一次多模态请求生成 AI 分类、标题和视觉预览；不支持或调用失败时仍诚实保留原图并标记为本地降级。
- 设置页新增“选择推荐偏好”入口；“感兴趣”和“不感兴趣”共享一套面向学习、学术与科研技能的中性主题气泡，由用户决定同一主题应提高还是降低推荐度。
- 两栏均可点击“换一批”浏览更多预设；刷新仅替换未选候选，已经选中的气泡会固定保留，两组都至少选择一个后才可保存并对新卡片生成推荐度。
- 自定义关键词输入默认隐藏，只有点击“添加自定义关键词”时出现；自定义词保存后同样显示为可点击删除的气泡。
- 新增 Vault 本地“深层偏好协议”：`selfgrow-wiki` Skill 只依据用户授权的项目摘要生成候选，先校验和展示，批准后才写入 `Preferences/preference-profile.json`；插件动态读取、可停用或查看，缺失/损坏时退回关键词评分。
- 模型只返回协议中实际命中的信号 ID，插件拒绝编造 ID 并应用已批准权重；来源项目名、路径和摘要记录不会发送给评分模型。
- 推荐度只使用当前捕获材料和用户配置的关键词，不再随插件捆绑个人偏好。
- Raw frontmatter 和筛选卡片记录并展示实际命中的兴趣/非兴趣关键词；模型返回未配置的关键词会被拒绝，而不是伪造成用户偏好。

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

### Friend branch merge

- 合并 `fix/mobile-review-stability`：
  - preference-based Raw scoring；
  - workspace review 与 Skill 集成；
  - 移动端 Review 稳定性修复；
  - `preference-protocol.json` 与 Skill references；
  - Python guard 新增 project link/summary/unlink 命令。
- 解决 `selfgrow_wiki.py` 合并冲突：
  - 保留我们的 `bootstrap` 命令；
  - 同时保留朋友的 `link-project`、`project-status`、`validate-project-summary`、`apply-project-summary`、`unlink-project` 命令。

### Verification

- 合并后验证：
  - `format:check` 通过；
  - `lint` 通过；
  - `typecheck` 通过；
  - 36 个测试文件，294 个测试全部通过；
  - Python guard `py_compile` 通过；
  - Python guard `self-test` 通过。
- 深层偏好协议构建通过：生产包 `main.js` 567,452 bytes（gzip 139,015 bytes），低于 750 KiB 预算且无 Node/Electron 移动端禁用导入。
- 最新 `main.js`、`manifest.json`、`styles.css` 已安装到 `D:\ai_test\test_remote\test_remote\.obsidian\plugins\selfgrow\`，三者与源码 SHA-256 一致；安装前用户已更新的 `data.json` 保持 SHA-256 `A58634CF2DB5B6C2CEAA1FA65F95533D267787F0F8F9A89B81C154F65CE10B66` 未变。

### Git status

- `feature/android-compat` 已推送到 `origin/feature/android-compat`。
- 该分支包含：
  - `64d0312 chore: enforce LF line endings on Windows checkouts`
  - `afbad02 chore: ignore generated release artifacts`
  - `f2cc819 docs: add changelog for test build and verification`
- 本地 `main` 仍领先 `origin/main` 两个提交，暂不直接推送 `main`。
- 协作者 UI 分支已在 `origin` 出现：`feature/ui-stabilization`。
