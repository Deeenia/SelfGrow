# SelfGrow for Obsidian — Vault Data Schema

Version: 5.0  
Persistent store: Obsidian Vault Markdown and plugin data  
Secrets: Obsidian SecretStorage

## 1. Data Ownership

- `Raw/Knowledge/` Raw Markdown is the default capture and review source of truth.
- `Wiki/` Markdown is the durable synthesis source of truth.
- Raw deletion never deletes compiled Wiki content.
- Plugin data may hold settings and rebuildable capture indexes, never Wiki prose.
- Secrets remain in SecretStorage.

## 2. Vault Layout

```text
SelfGrow/
├── Inbox Queue.md
├── Inbox/
│   └── Attachments/
├── Attachments/
└── Knowledge/
Wiki/                      # sibling of SelfGrow
├── Index.md
├── Log.md
├── Topics/
├── Concepts/
├── Methods/
├── Experiences/
├── Questions/
└── Assets/
```

`SelfGrow.md`, configurable `Raw/`, and `Wiki/` are siblings. `Raw/Knowledge/` remains flat; Wiki uses five fixed type folders plus Assets.

## 3. Inbox Schema

The existing Inbox schema and processing states remain valid for durable capture and retry:

```yaml
selfgrow_capture: true
selfgrow_id: 'uuid'
source_url: 'https://example.com'
normalized_url: 'https://example.com'
capture_method: 'share_sheet'
imported_at: '2026-08-10T12:00:00Z'
status: 'queued'
attempt_count: 0
capture_note: 'temporary fallback text'
capture_images:
  - 'SelfGrow/Inbox/Attachments/capture-1.png'
```

`capture_note`, OCR, and share residue are temporary. Complete extracted article bodies and transcripts are retained in the Raw card. Successful Raw commit removes the Inbox note and moves every retained image into `SelfGrow/Attachments/`.

## 4. Raw Card Schema

Current SelfGrow cards live under the fixed category folders `Raw/Project/`, `Raw/Skill/`, and `Raw/Experience/` (legacy folders such as `Knowledge/` remain readable and are never deleted automatically). Schema-v2 frontmatter carries Wiki selection; new text/link cards use the evidence-preserving body contract below, while the parser remains compatible with legacy AI-summary cards.

```yaml
---
selfgrow: true
selfgrow_layer: raw
selfgrow_schema: 2
selfgrow_id: "uuid"
selfgrow_category: "Project | Skill | Experience"
source_url: "https://example.com/article"
normalized_url: "https://example.com/article"
source_platform: "generic_web"
imported_at: "2026-08-10T12:00:00Z"
completed_at: "2026-08-10T12:01:00Z"
status: "completed"
output_language: "zh-CN"
content_hash: "sha256-hex"
wiki_selected: false
distillation_status: "not_started"
distillation_approved_hash: null
distilled_hash: null
distilled_at: null
wiki_targets: [] # portable sibling-Wiki paths such as Wiki/Concepts/RAG.md
distillation_error: null
recognition_source: "ai | local" # whether the recognition card came from AI or local fallback
source_github_owner: "acme"       # GitHub sources only
source_github_repo: "tool"        # GitHub sources only
github_readme_path: "README.md"   # GitHub sources only: chosen README for diagnosis
github_readme_language: "zh-CN | en | null"
---

# 标题

## 筛选预览

本地截取的一句话预览，仅用于筛选。

## 原始材料

### 提取正文

完整提取的正文以结构化 Markdown 保存在这里：来源 H1/H2 已降级为 H4/H5（其余标题保持在 H4–H6），代码围栏、表格、列表、引用、链接和图片原样保留；GitHub README 的相对链接和图片已改写为绝对 GitHub URL。禁止把正文压缩成单段或整体 blockquote。

## 我的笔记



## 来源

[打开原文](https://example.com/article)
```

Image Raw cards embed retained files from `SelfGrow/Attachments/`. They may use a one-sentence visual preview; text/link cards do not call Chat for summarization.

## 5. Raw Selection Schema

Allowed `distillation_status` values:

```text
not_started
queued
processing
completed
needs_update
failed
```

Rules:

- existing schema-v1 cards are presented as `wiki_selected: false`, `not_started` until the implementation migration writes v2
- selecting sets `wiki_selected: true`, copies `content_hash` to `distillation_approved_hash`, and sets `queued`
- Codex eligibility requires selected + queued + approved hash equal to content hash
- approval starts processing; successful completion writes `distilled_hash`, `distilled_at`, and `wiki_targets`
- editing user-visible Raw content recomputes `content_hash`; if it differs from `distilled_hash`, status becomes `needs_update`
- confirming an update copies the new hash into `distillation_approved_hash` and returns to `queued`
- cancelling before first completion sets unselected and `not_started`
- cancelling after completion sets unselected but preserves completion metadata and Wiki content

`content_hash` covers the Raw title, selection preview, source material, `我的笔记`, source URL, and image references. It excludes selection/distillation fields and timestamps.

`wiki_targets` persists portable `Wiki/...` paths. Runtime resolves them against the sibling Wiki directory on each device: `AI/Wiki/...` from desktop root `AI/SelfGrow`, and `Wiki/...` from the iPhone Vault root `SelfGrow`.

## 6. Wiki Page Schema

```yaml
---
selfgrow_wiki: true
wiki_schema: 1
wiki_type: "topic | concept | method | experience | question"
created_at: "2026-08-10T12:00:00Z"
updated_at: "2026-08-10T12:00:00Z"
source_count: 2
---

# 页面标题

## 当前认识

Codex 维护。

## 方法与边界

Codex 维护。

## 关联

Codex 维护的普通 [[wikilinks]]。

## 我的经验

用户维护；Codex 必须逐字节保留。
```

Codex may create an experience claim only from user-authored `我的笔记`, a user-created experience Raw, or explicit user confirmation in the active Codex conversation.

## 7. Wiki Index and Log

`Wiki/Index.md` is content-oriented and maintained after every approved batch. It groups links by page type and gives each page a one-line description.

`Wiki/Log.md` is append-only at the entry level:

```markdown
## [2026-08-10T12:00:00Z] distill | 3 Raw cards

- created: [[Concept A]]
- updated: [[Method B]]
- Raw targets updated: 3
```

Never include full source bodies, OCR dumps, secrets, or personal-note bodies in the log.

## 8. Images

- Inbox images are staging data while capture is retryable.
- Successful Raw images move to `SelfGrow/Attachments/` and persist until Raw deletion.
- Wiki-required images are copied directly under `Wiki/` during an approved Codex batch.
- Raw deletion removes only unreferenced Raw attachments.
- Wiki assets are independent of Raw deletion.

## 9. URL Index

The existing rebuildable normalized-URL/SelfGrow-ID index remains scoped to flat `Knowledge/` Raw cards. It prevents duplicate capture and self-heals missing paths. It does not index or constrain Wiki pages.

## 10. Raw Deletion

Deleting Raw removes:

- Raw Markdown
- capture URL/ID index entries
- Raw selection and distillation metadata
- unreferenced files under `SelfGrow/Attachments/`

It does not remove:

- Wiki pages or Wiki prose
- wikilinks between Wiki pages
- `我的经验`
- promoted assets under `Wiki/Assets/`

The next Codex maintenance pass removes unresolved links to deleted Raw paths without retracting synthesis. No `excluded` record or tombstone is stored.

## 11. Plugin Settings

Active settings:

```typescript
interface SelfGrowSettings {
  schemaVersion: number;
  rootPath: string;
  language: 'zh-CN' | 'en';
  chat: EndpointMetadata;
  extraction?: ExtractionProviderMetadata;
}
```

Vector and ranking settings are absent from the current schema. Chat and extraction secrets remain references to SecretStorage names.

## 12. Integrity Tests

- existing Raw appears unselected
- selection approves exactly one content hash
- changed Raw cannot process under an old approval hash
- cancelling removes queue eligibility
- completed Raw keeps selection until the user cancels
- cancelling or deleting Raw never deletes Wiki knowledge
- `我的经验` survives every Codex update byte-for-byte
- external content alone cannot produce an experience claim
- all successful Raw images survive Inbox cleanup
- Raw deletion removes only unreferenced Raw images
- promoted Wiki assets survive Raw deletion
- broken Raw links are cleaned without deleting Wiki prose
- Wiki writes remain contained under the Vault-root sibling `Wiki/`
- secrets and full source content never enter metadata or logs
