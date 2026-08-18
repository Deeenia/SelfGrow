# SelfGrow for Obsidian — Design Specification

Version: 5.0  
Status: Active mobile-first design

## 1. Direction

SelfGrow uses Obsidian's shell, themes, editor, properties, graph, backlinks, search, dialogs, and accessibility behavior. Collect and Review are equal navigation buttons and switch directly between the two plugin views.

Principles:

- content before controls
- explicit human admission to the Wiki
- native Obsidian capability before custom UI
- no AI spectacle, gamification, recommendation feed, or hidden automation
- 44 px minimum touch targets and no color-only state

## 2. Product Surfaces

Active surfaces:

- `SelfGrow Queue`: capture
- `SelfGrow Inbox`: failures, waiting, and retry
- `SelfGrow Review` / `知识筛选`: Raw selection, update approval, and cleanup
- normal Obsidian Markdown pages for Raw and Wiki
- Obsidian native graph/search/backlinks for navigation
- plugin settings for Chat and extraction

Cancelled surfaces:

- Today
- Favorites
- custom Map/search
- topic-tree management
- regeneration comparison
- export flow
- Clear All

## 3. Queue

The Queue keeps the current single-card layout:

- optional title
- one optional link/share-message/repository-name field
- a fixed three-way category selector: `Project`, `Skill`, `Experience`
- up to three images
- inline routing hint plus a one-line recognition suggestion
- one Save action

It has no separate content/note field. Source bodies, share residue, and OCR never populate `我的笔记`.

The category selector is the only destination choice; there is no free-form folder input and no `Knowledge` default. After the AI recognition card completes it updates the selector and title (unless the user already edited them) and shows the suggested preview; a local fallback is labeled `本地识别` and never masquerades as AI. A bare repository/Skill name without a URL triggers GitHub search on Save for `Project`/`Skill`: unique exact matches are adopted automatically, up to three candidates open in a native 44 px-target list (owner/repo, one-line description, stars, update time, archived badge) for confirmation, and a `未找到可靠 GitHub 仓库` notice keeps the original input when nothing matches.

Saving returns after durable local capture. Extraction and Raw generation continue in the foreground. Completed work leaves Inbox; recoverable failures remain.

## 4. Review View

Header:

```text
知识筛选
决定哪些 Raw 值得进入长期 Wiki
```

Use five filter chips or sections:

```text
未选择 | 待沉淀 | 已沉淀 | 内容已更新 | 失败
```

Each Raw card shows:

- title
- high-density preview
- source host/platform when present
- image thumbnail when present
- last content-update time
- selection/distillation marker
- affected Wiki targets after completion

Actions:

- Default cards show no checkbox and no repeated selection button.
- Double-tapping a card opens its Raw note; a single tap only gives press feedback, so swipes and opens never compete.
- Long-pressing a card enters multi-select and selects that card; there is no separate `多选` button.
- Outside multi-select, swiping a card right toggles the deposit decision (selects an unselected card, deselects a queued one) and swiping left opens the confirmed-delete flow. Cards under `已沉淀` never swipe right. Vertical scrolling wins until horizontal movement is clear, and incomplete swipes snap back with a spring.
- Multi-select reveals card checkboxes and one batch bar with a `已勾选 n 条` count; the `选择沉淀`, `取消沉淀`, and `删除` actions appear only while at least one card is checked, and `完成` always exits the mode. Tapping a card while multi-select is active toggles it.
- `确认更新` remains the only visible per-card primary action when a completed Raw changed.
- The card's overflow menu offers `选择沉淀`/`取消沉淀` and single-card `删除`.

Swipe gestures are disabled while multi-select is active, so card selection and single-card gestures never compete. Completing a batch action or pressing `完成` exits multi-select. Cards give fast press feedback with a spring release, swipe reveals slide in, checkboxes pop in on multi-select entry, and the batch bar eases in; reduced-motion preferences remove these transitions. Buttons use native hover plus a short pressed state, visible keyboard focus, and an `aria-busy` disabled state during asynchronous work. Deletion requires explicit confirmation. There is no `排除` action or persistent excluded state.

## 5. State Presentation

Use text plus icon:

```text
○ 未选择
✓ 已选择，等待 Codex
… Codex 处理中
✓ 已沉淀
↻ 内容已更新，需要确认
! 沉淀失败
```

Do not show fake percentages. A selected card remains visibly selected after completion. Cancelling it states that existing Wiki knowledge will remain.

## 6. Codex Handoff

The Review view does not pretend it can launch Codex. It explains the next action:

```text
已选择 4 条 Raw。
请在 Codex 中运行 selfgrow-wiki，处理已选择内容。
```

Codex presents its proposed pages and links in the Codex conversation. Approval happens there, not in a second Obsidian diff interface.

## 7. Raw Note Experience

Canonical Raw sections remain:

```text
标题
筛选预览 / 视觉预览
原始材料
我的笔记
来源
```

`我的笔记` starts empty and is always user-owned. It is the primary in-note source for future personal-experience synthesis.

Pure-image cards display the original image and one concise visual preview. Text-heavy screenshots, diagrams, interfaces, and photographs are interpreted visually; OCR alone is insufficient.

## 8. Wiki Page Experience

```text
标题
当前认识
方法与边界
关联
我的经验
```

The first three content sections are Codex-maintained after proposal approval. `我的经验` is protected from automatic edits. Dedicated Experience pages require explicit user-grounded material.

Relations are visible ordinary wikilinks. Obsidian graph filter `path:"Wiki"` provides the mature-knowledge view; including `SelfGrow/Knowledge` shows Raw evidence nodes.

## 9. Raw Cleanup

Distillation never triggers a modal asking to delete Raw. Completed Raw remains available in Review until the user acts.

Deleting Raw:

- removes its graph node and selection state
- does not remove Wiki knowledge
- removes unreferenced Raw attachments
- leaves promoted assets under `Wiki/Assets/` intact
- causes broken Raw-source links to be cleaned on the next Codex maintenance pass

## 10. Settings

Keep Chat and extraction settings with SecretStorage selectors and connection tests. Remove the Embeddings settings group when its obsolete runtime is removed.

## 11. Accessibility

- semantic labels and buttons
- keyboard and command-palette access
- VoiceOver labels
- 44 px touch targets
- theme-compatible contrast
- reduced-motion support
- mobile scrolling without dense tables

## 12. Out of Scope

- custom graph renderer, Canvas, graph database, or edge table
- custom global search
- Today/Favorites/Map replacements for native Obsidian
- auto-selection or auto-distillation
- automatic Codex launch
- inference of personal experience from external content
- export, PDF, Clear All, goals, streaks, notifications, and recommendations
