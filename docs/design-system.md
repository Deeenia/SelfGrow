# SelfGrow for Obsidian — Design Specification

Version: 5.0  
Status: Active mobile-first design

## 1. Direction

SelfGrow uses Obsidian's shell, themes, editor, properties, graph, backlinks, search, dialogs, and accessibility behavior. `收集` and `筛选` are equal navigation buttons and switch directly between the two plugin views. The shared `SelfGrow` brand and navigation provide enough context, so neither view repeats a page title or explanatory subtitle below the tabs.

Principles:

- content before controls
- restrained Material-style rounded surfaces with thin Obsidian-theme borders
- one Obsidian accent color and no gradients
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

Saving returns after durable local capture. Extraction and Raw generation continue in the foreground. On mobile, the current queued/extracting/generating item reuses the existing honest progress ring in a centered 152 px translucent, non-interactive overlay with percentage and stage text; its original row retains title, time, and actions without repeating the progress line. Waiting, incomplete, and failed items never become overlays, so their explanation and retry path remain visible. Desktop keeps the inline progress row. Completed work leaves Inbox; recoverable failures remain.

## 4. Review View

Header navigation:

```text
SelfGrow
收集 | 筛选
```

The folder filter begins directly below the navigation. There is no repeated `知识筛选` title or explanatory subtitle.

Use one horizontally scrollable status-tab row with live counts:

```text
未选择 24 | 待沉淀 4 | 已沉淀 128 | 更新 2 | 失败 1
```

Only the active status renders cards. Each status is divided into deterministic pages of at most 10 cards; previous/next controls appear only when another page exists. Changing the Raw folder, status, or page exits multi-select and clears temporary checkboxes so hidden cards can never receive a batch action.

Each Raw card shows:

- title
- high-density preview
- optional low-emphasis `推荐度 n` / `Fit n` plus one-sentence advisory reason when an AI score exists
- source host/platform when present
- image thumbnail when present
- last content-update time
- selection/distillation marker
- affected Wiki targets after completion

Actions:

- Default cards show no checkbox and no repeated selection button.
- Double-tapping a card opens its Raw note through Obsidian's native navigation history; a single tap only gives press feedback, so swipes and opens never compete. The host Back action returns directly to Review without reopening the plugin.
- Long-pressing a card enters multi-select and selects that card; there is no separate `多选` button.
- Outside multi-select, swiping a card right toggles the deposit decision (selects an unselected card, deselects a queued one) and swiping left opens the confirmed-delete flow. Cards under `已沉淀` never swipe right. Vertical scrolling wins until horizontal movement is clear, and incomplete swipes snap back with a spring.
- Multi-select reveals card checkboxes and a sticky batch bar only while at least one card is checked. The bar shows `已勾选 n 条` plus only the applicable `选择沉淀` or `取消沉淀` action, `删除`, and `完成`. On mobile it follows Obsidian's dynamic bottom spacing with a user-tuned 24 px visual overlap, keeping the controls close to but still above the floating navbar. Removing the final check exits multi-select automatically. Tapping a card while multi-select is active toggles it.
- `确认更新` remains the only visible per-card primary action when a completed Raw changed.
- The card's overflow menu offers `选择沉淀`/`取消沉淀` and single-card `删除`.

Swipe gestures are disabled while multi-select is active, so card selection and single-card gestures never compete. Completing a batch action or pressing `完成` exits multi-select. Cards give fast press feedback with a spring release, swipe reveals slide in, checkboxes pop in on multi-select entry, and the batch bar eases in; reduced-motion preferences remove these transitions. Buttons use native hover plus a short pressed state, visible keyboard focus, and an `aria-busy` disabled state during asynchronous work. Deletion requires explicit confirmation. There is no `排除` action or persistent excluded state.

## 5. State Presentation

Use text plus icon:

```text
○ 未选择
✓ 已选择，等待智能体
… 智能体处理中
✓ 已沉淀
↻ 内容已更新，需要确认
! 沉淀失败
```

Do not show fake percentages. A selected card remains visibly selected after completion. Cancelling it states that existing Wiki knowledge will remain.

Recommendation scores are advisory metadata, not state or a primary action. Cards without a valid AI score show nothing in its place. Never use recommendation color, ordering, or automation to override the user's explicit selection decision.

## 6. Agent Handoff

The Review view does not show a persistent agent instruction surface. The `待沉淀 n` tab is the compact queue indicator; the user invokes `selfgrow-wiki` from a supported coding agent when they are ready.

The agent presents its proposed pages and links in its conversation. Approval happens there, not in a second Obsidian diff interface.

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

The first three content sections are agent-maintained after proposal approval. `我的经验` is protected from automatic edits. Dedicated Experience pages require explicit user-grounded material.

Relations are visible ordinary wikilinks. Obsidian graph filter `path:"Wiki"` provides the mature-knowledge view; including `SelfGrow/Knowledge` shows Raw evidence nodes.

## 9. Raw Cleanup

Distillation never triggers a modal asking to delete Raw. Completed Raw remains available in Review until the user acts.

Deleting Raw:

- removes its graph node and selection state
- does not remove Wiki knowledge
- removes unreferenced Raw attachments
- leaves promoted assets under `Wiki/Assets/` intact
- causes broken Raw-source links to be cleaned on the next agent maintenance pass

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
- automatic agent launch
- inference of personal experience from external content
- export, PDF, Clear All, goals, streaks, notifications, and automated recommendation feeds
