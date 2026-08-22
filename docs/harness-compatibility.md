# SelfGrow Harness Compatibility

本文件说明如何在不同的 Agent harness 中运行 SelfGrow Wiki 工作流。

## 核心原则

SelfGrow 不依赖某一个 harness。所有 harness 最终都必须：

1. 进入用户的 Obsidian Vault 工作目录；
2. 读取 Raw 队列和当前 Wiki；
3. 生成 Wiki 修改提案；
4. 等待用户明确批准；
5. 调用同一个 Python guard 执行写入：

```text
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py
```

Python guard 是唯一的可信写入入口。即使某个 harness 不识别 Skill，也不能绕过 guard 直接写 Wiki。

## 通用前置条件

- Python 3.11+ 可用；
- harness 能执行 shell 命令；
- harness 有足够长的上下文读取 Raw 与 Wiki；
- harness 可以读取当前 Vault 目录。

## 统一命令

假设 Raw 目录是 `Raw`，Vault 根目录是当前目录：

```text
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py bootstrap --selfgrow-root Raw
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py discover --selfgrow-root Raw
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py validate --selfgrow-root Raw --plan plan.json
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py apply --selfgrow-root Raw --plan plan.json --approved
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py maintain --selfgrow-root Raw
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py clean --selfgrow-root Raw --approved
```

## 各 harness 入口

### Codex

Codex 会识别：

```text
skills/selfgrow-wiki/SKILL.md
skills/selfgrow-wiki/agents/openai.yaml
```

用户可以直接说：

```text
运行 selfgrow-wiki，处理已选择的 Raw。
```

### Claude Code

优先读取：

```text
skills/selfgrow-wiki/SKILL.md
```

如果 Claude Code 没有自动识别 Skill，则读取 Vault 根目录的：

```text
AGENTS.md
```

并执行统一的 Python 命令。

### opencode

在 Vault 目录启动：

```text
opencode <Vault 路径>
```

让它先读取：

```text
AGENTS.md
```

然后执行：

```text
python skills/selfgrow-wiki/scripts/selfgrow_wiki.py bootstrap --selfgrow-root Raw
```

### dsh

使用 headless profile 时，将 `BOOTSTRAP.md` 的内容作为任务上下文传入，或在 Vault 中放置 `AGENTS.md`。

### 其他 CLI harness

Kimi Code、Z Code 等没有内置 Skill 注册机制的 harness，建议：

1. 在 Vault 根目录放置 `AGENTS.md`；
2. 将 `skills/selfgrow-wiki/BOOTSTRAP.md` 内容粘贴到首条提示词；
3. 让 harness 从 `bootstrap` 命令开始。

## 最小冒烟测试

每个 harness 至少验证：

```text
- 能发现 Vault 根目录和 Raw 目录
- 能执行 bootstrap
- 能执行 discover
- discover 输出中 eligible/skipped 正确
- 不会在未批准时执行 apply
```

通过最小冒烟测试后，再测试真实蒸馏批次。

## 当前测试状态

| Harness | 状态 | 说明 |
|---|---|---|
| Codex | 待重测 | 本地 `config.toml` 的 `[agents]` 配置与当前 Codex CLI schema 不兼容 |
| Claude Code | 未测 | 账号不可用，本轮跳过 |
| opencode | 通过 | 成功读取 AGENTS.md，执行 bootstrap 并报告 eligible 为空 |
| dsh | 通过 | 成功执行 bootstrap，并正确停止于空队列 |
