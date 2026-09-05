# SelfGrow for Obsidian — Product Specification

Version: 5.0  
Status: Active source of truth  
Target: Personal, mobile-compatible Obsidian plugin plus a user-invoked Codex Wiki-maintenance skill

## 1. Product Definition

SelfGrow turns captured links, text, and images into Raw evidence cards, lets the user decide which cards deserve long-term attention, and uses Codex to maintain a persistent, interlinked Wiki above those selected sources.

```text
Capture
→ Raw evidence card under the configurable Raw/Knowledge folder
→ user reviews and selects
→ Codex proposes Wiki changes
→ user approves
→ Codex creates or updates linked Wiki pages
→ Obsidian renders the graph
```

The user owns admission to the Wiki. SelfGrow prepares only a local title and one-line selection preview for text and link material; full AI synthesis happens only after explicit selection in the Wiki workflow.

## 2. Product Layers

### Knowledge: Raw layer

`Raw/Knowledge/` is the default flat card directory. Its location is configurable and missing folders can be created from settings. Raw cards are evidence, not finished long-term knowledge.

Text and link Raw cards contain a local title, one-line selection preview, the complete extracted article body or transcript, the user-owned `我的笔记` section, the source link when available, and retained image references. Pure-image cards retain the original image and may contain a one-sentence visual preview.

### Wiki: durable synthesis layer

The Vault-root `Wiki/` directory, beside `SelfGrow/`, contains Codex-maintained synthesis:

```text
Wiki/
├── Index.md
├── Log.md
├── Topics/
├── Concepts/
├── Methods/
├── Experiences/
├── Questions/
└── Assets/
```

Wiki is a sibling of `SelfGrow/`, shortening the synchronized path while preserving fixed type folders that make category visible in the mobile file list. Page type also remains explicit in frontmatter; native wikilinks carry semantic structure.

Wiki pages are linked with ordinary Obsidian `[[wikilinks]]`. Obsidian's native graph, backlinks, search, properties, and editor are the browsing interface.

## 3. Capture and Raw Generation

The existing mobile-first collection routes remain:

- Obsidian iOS Share Sheet Location named `SelfGrow Inbox`
- `SelfGrow Collect` Shortcut appending one timestamped unchecked URL to `SelfGrow/Inbox Queue.md`
- Queue window accepting an optional title, one link/share-message/text field, and up to three images

The Collect form separates share-link text and body fields. The link field accepts a complete promotional share message and extracts its first HTTP(S) URL; remaining share copy joins the retained source material. Every new capture is assigned to one of three fixed categories — `Project`, `Skill`, or `Experience` — written under `Raw/Project/`, `Raw/Skill/`, or `Raw/Experience/`. There is no free-form folder choice and no `Knowledge` default. The AI recognition card suggests a category, title, preview and GitHub search terms after the raw body is extracted; the suggestion updates the category selector before saving, and the user can always override it manually. A bare GitHub project or Skill name (no URL) can be completed through a bounded GitHub search; a single high-confidence exact match is adopted automatically, up to three candidates are shown for confirmation, and no URL is ever fabricated. It accepts up to 20 local files (25 MB each, 100 MB total), including multiple images.

GitHub repository sources are extracted from their README instead of the HTML page. The extractor resolves `owner`/`repo` and the default branch, then selects the README in the user's language (explicit `README.zh-CN.md`-style names first, then same-repository language-switch links, then the default README). Relative links and images inside the README are rewritten to absolute GitHub URLs, and source headings are demoted (H1→H4, H2→H5) so they never collide with the fixed Raw structure. The chosen README path and language are recorded in Raw frontmatter for diagnosis.

All images belonging to a completed Raw card are retained under `SelfGrow/Attachments/` until that Raw card is deleted. AI-routed images are no longer terminally discarded after summary generation.

### AI recognition card

Every new text, link, and GitHub input produces one AI recognition card after the raw body is extracted. The AI only classifies the category (`Project`, `Skill`, or `Experience`), writes a short noun-phrase title, writes one 40–120 character selection-reason sentence, and optionally lists GitHub search terms; it never summarizes the full body — the Wiki remains the long-term synthesis layer. Output is strict JSON validated against the same rules: category must be one of the three, titles must not contain clichés like `这篇文章`/`本文介绍了`/`向大家推荐` or trailing punctuation, previews must be a single sentence that does not restate the title, and the whole card may be repaired at most once before a deterministic local fallback (GitHub sources default to `Project`, Skill-signal text to `Skill`, otherwise `Experience`). A local fallback is shown in the UI as a secondary hint and recorded as `recognition_source: local` in Raw frontmatter — it is never presented as an AI success.

The user maintains one Vault-local personal preference profile at sibling `Preferences/preference-profile.json`. A dedicated picker exposes separate interested and uninterested topic groups drawn from the same neutral learning, academic-discipline, research-method, and scholarly-skill pool; preset topics are one-tap bubbles, selected bubbles survive “new batch”, and custom input remains hidden until requested. Saving the picker creates or replaces only versioned plugin-managed manual signals inside the same profile (`manual-interest-*` / `manual-uninterest-*`, weight ±8); it never creates a separate keyword scoring path. The user-reviewed `selfgrow-wiki` Skill may independently create or update project-derived weighted preferences from explicitly authorized summaries and must preserve those manual signals exactly. Both initialization orders are supported: topic selection may create a source-free base profile before an Agent update, or an Agent may create the base profile before topics are added. Empty topic groups remove only manual signals and preserve unrelated Agent-derived signals and source references. `preference-protocol.json` contains only generic scoring rules; no personal profile ships with the plugin. The model receives the complete positive and negative preference names, weights, and descriptions—but not internal IDs, source records, paths, or project names—and directly returns an advisory `0–100` score, a natural-language reason, and optional human-readable matched preference names. The Review card derives a stable descriptive degree from that score without adding another model field: `0–39` is `不太推荐`, `40–59` is `一般`, `60–79` is `值得关注`, and `80–100` is `强烈推荐`. Matched preference names are displayed only after sanitization and never gate score validity. Core card fields and recommendation fields are validated separately; an invalid recommendation hides the score and shows a friendly notice while preserving the title, category, preview, and capture. A failed full text/link card gets one core-only repair before deterministic local fallback, so recommendation complexity cannot block collection. The generic protocol version and profile version are stored with successful scores. A missing, disabled, invalid, or signal-empty profile disables scoring. Changing the profile affects only future captures; historical Raw cards are never silently rescored, and recommendations never auto-select, reject, delete, reorder, prioritize processing, or change Wiki eligibility.

Pure-image captures use one multimodal request when the selected model is known or explicitly marked as supporting image input. That request uses bounded JSON output with enough response space for the category, concise title, visual preview, and—when a signal-bearing personal profile is active—the same independently validated recommendation metadata as ordinary links. A complete Markdown `json` fence is accepted defensively for compatible providers. If recommendation fields are invalid, the visual card remains valid and unscored. If the model lacks image support, the visual core JSON fails validation, or the request fails, SelfGrow retains the original image, writes a distinct honest local fallback for that failure class, and never labels it as AI recognition or falsely claims that a format failure means the model cannot understand images.

GitHub name completion applies only to `Project` and `Skill` inputs without a URL: the GitHub Search API is queried with bounded terms (original name, stripped name, `skill` variant, owner/repo), candidates are ranked by exact repo-name match, owner match, description/README mention, archive status, recency, and weak star signal. A single high-confidence exact match is adopted automatically; otherwise up to three candidates are shown for user confirmation; with no reliable result the original input is kept and the user is told `未找到可靠 GitHub 仓库` — no URL is fabricated. `Experience` input is never force-searched because of technical-looking words.

On mobile, the foreground queued/extracting/generating capture is represented by a centered translucent progress ring showing its existing durable stage percentage and localized stage text, outside the bottom-navbar region. The corresponding Inbox row keeps its identity and actions but does not repeat the progress line. Waiting-network, waiting-configuration, incomplete, and failed captures stay as ordinary cards with their explanation and retry/delete actions; desktop retains the inline progress presentation. Completed Inbox captures disappear immediately.

## 4. Raw Review

SelfGrow replaces the planned Today and Favorites surfaces with one mobile-safe view:

```text
SelfGrow Review / 知识筛选
```

It switches between five counted status pages:

- 未选择
- 已选择 / 待沉淀
- 已沉淀
- 内容已更新
- 处理失败

Only the active status renders cards, in deterministic pages of at most 10. Changing folder, status, or page clears temporary selection and exits multi-select. Default cards prioritize content and show no checkbox, repeated selection button, Codex instruction card, or empty batch toolbar. Double-tapping a card opens its Raw note through Obsidian's native navigation history, so the host Back action returns directly to Review; a single tap only gives press feedback, so swipes and opens never compete. Long-pressing a card enters multi-select and selects it, so no separate `多选` button is needed. Outside multi-select, swiping a card right toggles its deposit decision (selects an unselected card, deselects a queued one) and swiping left starts its confirmed-delete flow; distilled cards never swipe right. Multi-select reveals checkboxes and one sticky batch action bar only while at least one card is checked; it shows only the applicable selection/cancellation action plus `删除` and `完成`, follows Obsidian's dynamic mobile bottom spacing with a user-tuned 24 px visual overlap, and exits when the final check is removed. Swipe gestures are disabled while multi-select is active. The view supports:

- batch select for distillation
- batch cancel selection
- confirm an updated version for another distillation pass
- select/deselect or delete one Raw from its overflow menu
- batch delete with confirmation

Selection is persisted in Raw frontmatter. No second queue Markdown file exists.

## 5. Selection and Update Rules

- A new or existing Raw card starts unselected.
- Selecting records approval for the card's current content hash and queues it for Codex.
- Cancelling before processing removes it from eligibility and invalidates any unapproved proposal.
- After successful distillation, `wiki_selected` remains true.
- Editing a distilled Raw card changes its content hash and marks it `needs_update`.
- The user must explicitly confirm the new hash before Codex may update the Wiki.
- Cancelling selection after distillation stops future updates; existing Wiki knowledge remains.

## 6. Codex Distillation

The plugin does not invoke Codex or maintain an agent backend. It persists the selection state. The user opens Codex and invokes a `selfgrow-wiki` skill to process eligible Raw cards.

For each batch Codex must:

1. scan selected, approved Raw frontmatter
2. read the complete Raw evidence and retained images
3. revisit the source URL when possible
4. inspect `Wiki/Index.md` and relevant existing pages
5. propose the pages and links to create or update in the Codex conversation
6. wait for explicit user approval
7. update only AI-owned Wiki sections
8. preserve every `我的经验` section byte-for-byte
9. update Wiki links, `Index.md`, `Log.md`, and Raw distillation metadata

If a URL is no longer accessible, Codex may use the retained Raw evidence but must mark the source as unavailable for re-verification. It must not invent missing details.

## 7. Wiki Classification and Links

The initial page types are fixed and minimal:

- `Topics`: evolving subject hubs
- `Concepts`: concepts, technologies, and architectures
- `Methods`: methods, workflows, and tools
- `Experiences`: explicitly user-grounded practice
- `Questions`: unresolved questions and knowledge gaps

Topic names emerge from accepted material; SelfGrow does not impose a fixed taxonomy or create AI classification folders under Knowledge.

Relations use native Markdown links, for example:

```markdown
上位主题：[[AI 工程]]
依赖：[[提示词设计]]
对比：[[RAG]]
相关方法：[[渐进式知识压缩]]
```

Do not force meaningless links. A graph database, edge table, Canvas, or custom graph renderer is not on the active roadmap; reconsider only after native links demonstrate a concrete limitation.

## 8. Wiki Page Contract

```markdown
# 页面标题

## 当前认识

AI 维护的综合结论。

## 方法与边界

适用条件、步骤、限制和冲突。

## 关联

[[上位主题]]、[[相关概念]]、[[相关方法]]

## 我的经验

仅由用户维护，Codex 不得覆盖。
```

Only text from a Raw card's `我的笔记`, a user-created experience Raw card, or an explicit confirmation in the Codex conversation may create or update `Experiences`. External sources may produce concepts, methods, or viewpoints but never masquerade as personal experience.

## 9. Raw Deletion

Deleting Raw removes the Raw Markdown node and its selection metadata. It never deletes or rolls back distilled Wiki text, relationships, or experiences.

On the next Codex maintenance pass, broken links to deleted Raw files are removed while Wiki prose remains. If a Raw image is important to the Wiki, Codex copies it directly under `Wiki/` during the approved distillation pass. Other unreferenced Raw attachments may be deleted with their Raw card.

There is no persistent `excluded` or tombstone state. Recollecting the same source later creates a new Raw decision.

## 10. AI and Privacy

- Chat configuration remains OpenAI-compatible and uses Obsidian SecretStorage.
- Extraction-provider configuration and disclosure remain supported.
- The previous vector configuration and derived index have been removed from settings, storage, and runtime.
- Source bodies, OCR, share residue, API keys, tokens, and Cookies never enter logs.
- Full source text is not persisted; Codex revisits links during distillation.
- Raw and Wiki Markdown remain local-first under the user's Vault and chosen sync system.

## 11. Active Scope

Required:

- current capture, extraction, compact summarization, retry, and duplicate safety
- persistent Raw cards in flat `Knowledge/`
- permanent Raw image retention until Raw deletion
- `SelfGrow Review` selection and cleanup view
- durable selection, approval-hash, update, target, and failure metadata
- user-invoked `selfgrow-wiki` Codex skill
- proposal and approval in the Codex conversation
- linked Wiki pages and protected user-experience sections
- native Obsidian graph, backlinks, search, properties, and editing
- Chinese and English UI/output

Cancelled and replaced by the Wiki workflow:

- SelfGrow custom Map
- custom keyword/vector search and Embeddings roadmap
- AI classification folders and Topic Folder UI
- similar-content warning workflow
- Today and Favorites views
- old generated-card regeneration comparison
- Markdown/PDF export features
- Clear All and subtree-deletion product flows

Still excluded:

- standalone iOS/Android/Web app
- backend, account, remote database, or product cloud
- embedded platform-login browser
- automatic Wiki promotion without user selection
- automatic Codex launch from Obsidian
- custom graph database, edge store, Canvas, or graph renderer
- automated recommendation feeds, goals, streaks, notifications, and collaboration

## 12. Prototype Authority

`prototype.png` is historical visual reference only. This specification and Obsidian's native surfaces are authoritative.
