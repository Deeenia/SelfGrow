# SelfGrow for Obsidian — Development Tasks

Version: 5.0  
Execution: one task at a time  
Environment: Windows development, Obsidian desktop tests, iPhone mobile validation

## 1. Mandatory Rules

Every coding agent must:

1. Read all six files in `/docs` completely.
2. Execute only the assigned Task ID.
3. Inspect existing code and dependencies before editing.
4. Follow current official Obsidian plugin and mobile guidance.
5. Keep `isDesktopOnly: false` and avoid Node/Electron APIs in mobile paths.
6. Use Obsidian Vault/FileManager/frontmatter APIs rather than raw filesystem operations.
7. Use `requestUrl` for production mobile network requests.
8. Use SecretStorage for API Keys and provider secrets.
9. Validate every external response and SelfGrow note schema.
10. Never log source bodies, personal notes, API Keys, tokens, or Cookies.
11. Add tests for domain invariants and destructive operations.
12. Do not add standalone-app, backend, account, Explore, custom Map/search/graph, or cancelled V4 roadmap features.
13. Treat `Knowledge/` cards as Raw; never promote them into `Wiki/` without an exact user-approved content hash.
14. Preserve Wiki `我的经验` byte-for-byte during Codex-maintained edits.

The following engineering rules remain mandatory:

- 不以维护向后兼容性为目标。对于已经废弃的代码路径，应直接移除，不再通过兼容层、回退机制或迁移方案予以保留。
- 在充分满足当前需求的前提下，采用尽可能简单的实现方案。避免引入缺乏实际需求依据的抽象、配置项和间接层。
- 采用渐进式、分层的方式构建系统。首先完成能够端到端运行的最小版本，再基于稳定可用的产品逐步增加功能。不要以尚未成熟的复杂性取代已经可用的产品。
- 保持组件的模块化，并明确划分不同职责与关注点。
- 当成熟且维护良好的库能够降低整体复杂度或提高可靠性时，应优先采用。除非有明确理由，不要重复实现通用功能。
- 在自行实现功能或新增依赖之前，应优先评估项目现有依赖的能力。应先查阅相关文档和类型定义，不应未经确认就认定某个库不具备所需能力。
- 架构决策应着眼于长期演进。不要采用仅能解决当前问题、且预期需要在后续替换的权宜方案。
- 在设计解决方案之前，先研究成熟产品如何解决同类问题。优先采用经过验证的模式和约定，避免从零开始另行设计一套方案。

Required note migrations protect current files while moving them to the current schema, then remove obsolete readers and writers.

## 2. Standard Task Prompt

```text
You are developing SelfGrow for Obsidian, a mobile-compatible TypeScript plugin.

Read completely:
1. docs/product-spec.md
2. docs/system-architecture.md
3. docs/design-system.md
4. docs/database-schema.md
5. docs/api-contracts.md
6. docs/development-tasks.md

Execute only Task-[ID].

Before coding:
- inspect repository and dependencies
- read relevant official Obsidian API documentation and current types
- identify mobile restrictions
- list expected file changes and invariants
- research maintained existing solutions before adding a package

Implementation rules:
- keep isDesktopOnly false
- no Node/Electron API in mobile paths
- use Obsidian APIs for Vault, frontmatter, requests, and secrets
- validate untrusted input
- never expose secrets or personal content in logs
- add focused tests
- do not implement later tasks or deferred product features
- 不以维护向后兼容性为目标。对于已经废弃的代码路径，应直接移除，不再通过兼容层、回退机制或迁移方案予以保留。
- 在充分满足当前需求的前提下，采用尽可能简单的实现方案。避免引入缺乏实际需求依据的抽象、配置项和间接层。
- 采用渐进式、分层的方式构建系统。首先完成能够端到端运行的最小版本，再基于稳定可用的产品逐步增加功能。不要以尚未成熟的复杂性取代已经可用的产品。
- 保持组件的模块化，并明确划分不同职责与关注点。
- 当成熟且维护良好的库能够降低整体复杂度或提高可靠性时，应优先采用。除非有明确理由，不要重复实现通用功能。
- 在自行实现功能或新增依赖之前，应优先评估项目现有依赖的能力。应先查阅相关文档和类型定义，不应未经确认就认定某个库不具备所需能力。
- 架构决策应着眼于长期演进。不要采用仅能解决当前问题、且预期需要在后续替换的权宜方案。
- 在设计解决方案之前，先研究成熟产品如何解决同类问题。优先采用经过验证的模式和约定，避免从零开始另行设计一套方案。

After coding:
- run format, typecheck, unit tests, and build
- test inside Obsidian desktop when applicable
- report mobile validation separately
- list changed files, exact results, and remaining risks
```

## Phase A — Source of Truth and Feasibility

### Task-001 Freeze V4 Documentation

Acceptance:

- six documents use SelfGrow for Obsidian and Version 4.0
- no active Swift, SwiftUI, Xcode, standalone Share Extension, SQLite source-of-truth, backend, account, Explore, or cross-link design
- Markdown/frontmatter, SecretStorage, and foreground plugin processing agree across documents
- prototype is explicitly non-authoritative for the app shell

### Task-002 iOS Capture and Shortcut Spike

Acceptance:

- verify Obsidian 1.13+ Share Sheet on iOS 18
- create a SelfGrow Inbox Location and template
- record observed structured Bilibili capture and plain-text Douyin capture
- verify copy-only Xiaohongshu and Weibo behavior
- build `SelfGrow Collect`: clipboard URL → background `Capture to Bookmark` append in `SelfGrow/Inbox Queue.md`
- use one `yyyyMMdd-HHmmss` queue token and exact `- [ ] <token> <URL>` grammar
- add `SelfGrow Collect` to iOS Control Center
- capture representative generic, YouTube, and social URLs through every applicable route
- record exact URL, metadata, and full-text behavior
- verify offline capture
- determine how stable IDs are assigned
- document limitations without assuming custom iOS code

Validated on 2026-08-07 on the target iPhone: Xiaohongshu, Bilibili, Weibo, and Douyin links appended in chronological order without opening Obsidian. A Douyin share-text false-positive `mailto:` demonstrated why the queue must use the selected first HTTP(S) item rather than the entire detected URL list.

### Task-003 Extraction Feasibility Spike

Research and test current approaches for generic articles, YouTube, Bilibili, Xiaohongshu, Douyin, and WeChat Official Accounts.

Acceptance:

- captured-text, anonymous direct, and third-party paths compared
- official/current primary documentation reviewed
- representative fixtures or allowed public samples
- metadata-only distinguished from complete extraction
- provider cost, region, credential transmission, maintenance, and policy risks recorded
- choose the first extractor for the minimal end-to-end slice

Completed on 2026-08-07. Four real mobile queue fixtures were tested without persisting bodies or tracking tokens. The Xiaohongshu text/image fixture exposed complete caption text through undocumented page state; the Bilibili fixture had metadata but no subtitles; Weibo was visitor-gated; Douyin exposed metadata but no transcript. A public generic article was complete through direct HTML and a Reader-service comparison.

Decision: the first end-to-end extractor is bounded `requestUrl` HTML parsed with native WebView `DOMParser`, Mozilla Readability, Obsidian `sanitizeHTMLToDom`, and Obsidian `htmlToMarkdown`. Anonymous platform parsing is opportunistic. TikHub is the initial configurable social-provider candidate, not a hard-coded dependency. Metadata-only and video-without-transcript results remain `incomplete_extraction`. Extraction evidence is in `docs/research/task-003-extraction-feasibility.md`; dependency evidence is in `docs/research/task-004-dependency-evaluation.md`.

### Task-004 Dependency Evaluation

Evaluate existing Obsidian APIs first, then maintained packages for:

- runtime schema validation
- HTML article extraction
- Markdown section parsing
- keyword indexing
- PDF generation
- test HTTP fixtures

Acceptance:

- current docs/types, license, maintenance, mobile compatibility, bundle size, and testability checked
- no Node-only package selected for mobile runtime
- one concrete reason per dependency

Completed on 2026-08-09. The evaluation selected Zod 4, Mozilla Readability, `mdast-util-from-markdown`, and MiniSearch for production runtime. Native WebView `DOMParser` plus Obsidian `sanitizeHTMLToDom` and `htmlToMarkdown` replace separate DOM, sanitizer, and Turndown dependencies. jsPDF is only the Task-037 mobile spike candidate, is not added before that task, and is not yet a supported export path. Vitest, jsdom, and an injected `FixtureHTTPTransport` are development-only; jsdom's install version must match the development Node engine. No package was installed and no plugin was scaffolded. Full evidence and rejections are in `docs/research/task-004-dependency-evaluation.md`.

## Phase B — Plugin Foundation

### Task-005 Scaffold Plugin

Use current official Obsidian sample-plugin conventions.

Acceptance:

- TypeScript, esbuild, manifest, styles, and npm scripts
- plugin ID and folder name match
- `isDesktopOnly: false`
- minimal `onload`/`onunload`
- format, typecheck, test, and production build commands
- no stale standalone-app files

Completed on 2026-08-09. Added the minimal `selfgrow` 0.1.0 community-plugin scaffold with TypeScript, esbuild, manifest/versions files, empty mobile-compatible `onload()`/`onunload()`, scoped CSS, Prettier, ESLint plus official Obsidian rules, Vitest, and npm scripts. The production build emits an esbuild metafile, enforces a 50 KiB scaffold budget, and rejects Node/Electron imports from the mobile bundle. `npm run check` passed formatting, lint, 3 tests, source/test typechecking, and a minified production build; `main.js` was 602 bytes (408 bytes gzip). No product behavior or Task-006 test boundary was implemented.

### Task-006 Test Harness and Mock Obsidian Boundary

Acceptance:

- domain tests run without a live Vault
- narrow adapters for Vault, metadata, SecretStorage, and HTTP
- obviously fake secrets
- deterministic time and timezone injection
- sample plugin fixture Vault

Completed on 2026-08-09. Added narrow mobile-safe ports for Vault text operations, frontmatter, secret resolution, HTTP, and temporal context. Development-only adapters provide an in-memory Vault/frontmatter store, obviously fake secrets, fixed time/timezone, and an exact-match HTTP fixture transport that never accesses the network, rejects unknown requests, deep-copies responses, records redacted calls, and models redirects, timeout, and oversized-body outcomes. A synthetic sample Vault includes a queued capture and a complete `.obsidian/plugins/selfgrow/` fixture installation. `npm run check` passed formatting, lint, 12 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip). No production Obsidian adapter, domain model, or product behavior was added.

### Task-007 Domain Models and State Machine

Acceptance:

- typed IDs, paths, platforms, languages, states, generated knowledge, topic nodes, favorites, candidates, and errors
- legal transition checks
- no `any` used to bypass typing
- exhaustive state tests

Completed on 2026-08-09. Added branded `SelfGrowID` and `VaultPath` types; explicit platform, language, and processing-state sets; generated-knowledge, recursive topic, favorite, candidate, and note-summary models; the complete documented stable error-code union and `SelfGrowError`; and a closed legal-transition table. Exhaustive tests evaluate every destination from every one of the 10 processing states, including terminal completion and explicit retry edges. `npm run check` passed formatting, lint, 29 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip). No `any`, settings, Vault behavior, or later product feature was added.

### Task-008 Settings and Secret References

Acceptance:

- provider presets OpenAI, DeepSeek, Qwen, Custom
- Base URL, model, SecretStorage name
- Chat and Embedding configurations independent
- editing fields invalidates test state
- secrets absent from `data.json`, snapshots, and logs
- clear-all ownership rules for shared secrets

Completed on 2026-08-09. Added independent Chat and Embeddings endpoint settings for the OpenAI, DeepSeek, Qwen, and Custom presets, storing only Base URL, model, and SecretStorage name. Endpoint edits invalidate only the corresponding connection-test metadata, including stale tests found during validated load. Zod 4.4.3 is configured once with jitless mode before the strict settings schema is constructed; unknown fields, including attempted embedded secret values, are rejected. The production SecretStorage resolver retrieves values by reference only at request time. Clear-all planning deletes every explicitly SelfGrow-owned secret name while preserving and reporting shared references. Persisted settings and safe log summaries contain no secret values. `npm run check` passed formatting, lint, 41 tests, source/test typechecking, and production build; the still-uncomposed foundation left `main.js` at 602 bytes (408 bytes gzip). npm installation audited 376 packages with zero known vulnerabilities.

## Phase C — Vault Model

### Task-009 Path Guard and URL Normalization

Acceptance:

- all paths normalized
- destructive targets contained under configured SelfGrow root
- HTTP(S) URL validation
- tracking and fragments handled safely
- platform short-link fixtures
- repeated normalized URL identity

Completed on 2026-08-09. Added branded-path canonical validation, an injected `PathGuard`, and the production Obsidian `normalizePath` adapter. Root containment and strict descendant checks reject traversal and sibling-prefix targets. Added an HTTP(S)-only URL service that rejects credentials and lexical local/private targets, removes fragments and an allowlist of known tracking parameters while preserving content identifiers, classifies every supported platform, and resolves approved priority short hosts through the injected exact-match HTTP fixture boundary with redirect-loop, redirect-count, and unsafe-target checks. Repeated normalized identities and Bilibili short-link fixtures are covered. `npm run check` passed formatting, lint, 65 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip).

### Task-010 Knowledge Note Parser and Serializer

Acceptance:

- frontmatter schema validation
- canonical generated sections
- user Markdown preserved
- safe conflict when sections are ambiguous
- parser/serializer round-trip fixtures in Chinese and English
- no raw source section in completed note

Completed on 2026-08-09. Added a strict Zod knowledge-frontmatter schema and an mdast source-position parser over the exact Markdown string. Canonical Chinese and English title/summary/core/personal/source sections round-trip deterministically; core H3 items are typed; personal Markdown is sliced from the original bytes; fenced-code headings are ignored; and missing, duplicate, reordered, unknown raw-source, empty, or mismatched-source structures fail with a safe conflict instead of being rewritten. The serializer emits body Markdown only, leaving YAML ownership to Obsidian frontmatter APIs. Added `mdast-util-from-markdown` 2.0.3 as the Task-004-selected dependency; installation audited 408 packages with zero known vulnerabilities. `npm run check` passed formatting, lint, 74 tests, source/test typechecking, and production build; the uncomposed `main.js` remained 602 bytes (408 bytes gzip).

### Task-011 Inbox Reconciliation

Acceptance:

- parses only the fixed bookmarked queue note and exact unchecked-task grammar
- materializes queue entries before acknowledging them
- assigns missing IDs safely
- derives queue import time from the capture token and current device timezone; Vault `ctime` is a legacy fallback
- normalizes Share Sheet, clipboard-shortcut, and constrained one-URL shared-text captures
- ignores unrelated/malformed notes without mutation
- oldest eligible capture first
- duplicate capture ID idempotent
- same normalized URL routed to re-import behavior

Completed on 2026-08-09. Added exact queue parsing, IANA-timezone conversion of `yyyyMMdd-HHmmss`, stable SHA-256 queue target names, browser `crypto.randomUUID()` capture IDs, materialize-before-acknowledge ordering, and restart-safe reuse. Reconciliation scans only the configured Inbox, strictly validates SelfGrow frontmatter, adopts structured captures and constrained exactly-one-HTTP(S)-URL shared text, normalizes every URL, persists missing IDs/timestamps/state through the frontmatter port, uses Vault `ctime` only for valid legacy captures, sorts oldest first, deduplicates capture IDs, and labels indexed normalized URLs as re-imports. Unrelated, ambiguous, unsafe, and malformed notes remain byte-for-byte untouched. `npm run check` passed formatting, lint, 80 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip).

Product-entry refinement on 2026-08-09 added durable canonicalization of desktop-pasted bare URLs and unchecked URL tasks using the current device-local token before materialization. It also marks managed captures with `selfgrow-internal` so production presentation can hide the raw Inbox folder, frontmatter properties, and technical title while preserving durable state and the operational Inbox UI.

### Task-012 URL and Note Indexes

Acceptance:

- normalized URL and SelfGrow ID maps
- rebuild from Knowledge root
- incremental create/move/rename/delete events
- no whole-Vault scan during common actions
- re-import updates `imported_at` without changing body or folder

Completed on 2026-08-09. Added a rebuildable schema-versioned URL/SelfGrow-ID index scoped strictly to `SelfGrow/Knowledge/`, with validated deterministic snapshots and reverse path identity for incremental maintenance. Explicit rebuild performs one scoped Markdown listing; create, note move, folder rename/move, note delete, and subtree delete update maps without scanning. Duplicate URLs, IDs, and paths are rejected before mutation so a failed event preserves the prior index. Re-import resolves the indexed path and changes only `imported_at` through the frontmatter port, preserving body, folder, favorite state, and identity. `npm run check` passed formatting, lint, 85 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip).

Startup fix on 2026-08-10: a live Vault contained two root-level Knowledge files with the same `selfgrow_id` and `normalized_url`, causing rebuild to abort all workspace initialization. Rebuild now sorts paths and indexes the first non-conflicting identity while preserving every Markdown file unchanged. Incremental/runtime duplicate insertion remains fail-closed.

Deletion-coherence fix on 2026-08-10: normalized-URL lookup now verifies the indexed Markdown still exists and removes a missing path from all identity maps. Final note insertion repeats stale-conflict pruning so a deletion between lookup and commit cannot cause `DUPLICATE_URL`. A user-deleted card can therefore be generated again without restarting the plugin.

### Task-013 Topic Folder Service

Acceptance:

- multiple root folders
- create, rename, and move
- descendant-cycle prevention
- move note to one topic
- exact subtree impact counts
- no `_topic.md` files without a proven need

Completed on 2026-08-09. Added a folder-backed topic forest with multiple sorted roots, recursive child folders, and validated completed-note summaries. Create, rename, topic move, and note move validate portable names, normalized Knowledge-root containment, source/destination types, collisions, and self/descendant cycles before mutation; successful moves emit incremental index events. Exact deletion impact counts descendants and completed SelfGrow notes without deleting anything. No `_topic.md` metadata files are created. Added mobile-safe production adapters using Obsidian `Vault`, `FileManager.renameFile()`, `MetadataCache`, and `processFrontMatter()`, plus expanded in-memory tree fixtures. `npm run check` passed formatting, lint, 90 tests, source/test typechecking, and production build; `main.js` remained 602 bytes (408 bytes gzip).

## Phase D — AI and Extraction

### Task-014 Obsidian HTTP Transport

Acceptance:

- production adapter uses `requestUrl`
- timeouts and response-size limits
- HTTP(S) and redirect safety
- header redaction
- fixture transport tests
- no Axios or mobile-path browser fetch

Completed on 2026-08-09. Added a production `ObsidianHTTPTransport` backed by `requestUrl` with `throw: false`, Phase C HTTP(S)/credential/local/private target validation, visible redirect `Location` validation, positive finite request limits, explicit timeout racing, and `arrayBuffer.byteLength` response bounds before text access. Request failures map to existing typed safe errors without retaining external messages, headers, bodies, or full URLs. The exact fixture transport now shares request-limit, URL, redirect, and real UTF-8 body-bound behavior while preserving fail-closed route matching, defensive copies, ordered calls, and case-insensitive Authorization/Cookie redaction. `npm run check` passed formatting, lint without warnings, 104 tests, source/test typechecking, and production build; the uncomposed `main.js` remained 602 bytes (408 bytes gzip). Obsidian `requestUrl` exposes neither cancellation nor a redirect mode/final URL in its public API, so timeout racing discards late settlement and redirect checks apply to 3xx responses visible to the adapter; on-device redirect behavior remains a later integration-validation item.

### Task-015 Chat Connection Test

Acceptance:

- OpenAI-compatible Chat Completions probe
- URL, authentication, model, protocol, and response validation
- SecretStorage resolution at request time
- localized safe errors

Completed on 2026-08-09. Added a bounded OpenAI-compatible Chat Completions probe with per-request secret resolution, exact fixture coverage, configuration/model/protocol validation, and localized redacted failures.

### Task-016 Embedding Connection Test

Acceptance:

- OpenAI-compatible Embeddings probe
- count, dimensions, finite-vector checks
- deterministic model fingerprint
- malformed fixtures rejected

Completed on 2026-08-09. Added an independent Embeddings probe with count, index, dimension, finite-vector, malformed-response, and deterministic fingerprint validation.

### Task-017 Generation Schema and Prompt V1

Acceptance:

- runtime schema for title, summary, core knowledge, one theme path, and languages
- faithful source-grounded prompt
- Chinese/English output
- prompt-injection isolation
- adversarial fixture tests

Completed on 2026-08-09. Added strict bounded V1 generation output parsing and an exactly two-message, source-grounded Chinese/English prompt that treats the complete source payload as untrusted JSON data.

Product-entry refinement on 2026-08-09 introduced prompt v2 recognition cards while preserving the same strict JSON and Markdown contracts: summaries are bounded to 500 characters, core knowledge to one through three items, and each explanation to 300 characters. The prompt prioritizes definition, purpose, use, essential complexity, and one key constraint rather than comprehensive source coverage.

The iCloud portability refinement on 2026-08-09 introduced prompt v3. A later flat-storage refinement keeps its compact recognition-card contract but ignores suggested topic paths: notes are stored directly under `Knowledge` using the sanitized article title only.

The Queue-routing refinement on 2026-08-10 introduced prompt v4. It requires exactly one compact summary paragraph describing the central technology/architecture/idea/method, its purpose, and the source-supported implementation path. The strict summary bound is 300 characters; at most two concise core items may clarify a non-repeating implementation step or constraint.

The density-template refinement on 2026-08-10 introduced prompt v5 and superseded v4 routing. Any supplied text now uses AI regardless of length; pure links also use AI, while only image-only/image-plus-link material without text remains direct. The prompt silently selects one of eight compression templates—technical tutorial, viewpoint/argument, experience sharing, method/framework, tool/product, case review, concept explanation, or update/news—and emits one paragraph bounded to 280 characters plus exactly one non-repeating core clarification bounded to 140 characters.

### Task-018 Captured-Text and Generic Extraction

Acceptance:

- use complete Share Sheet text when available
- generic public-article extraction fallback
- metadata-only incomplete result
- headings/lists/code retained where relevant
- temporary body not persisted after completion

Completed on 2026-08-09. Added captured-text priority and bounded generic HTML extraction through Readability, sanitization, Markdown conversion, canonical-URL handling, complexity limits, and honest incomplete outcomes. Temporary source lifetime is enforced by Task-024.

### Task-019 YouTube Extraction

Acceptance:

- Share Sheet capture assessed first
- public transcript path when available
- no restricted-media bypass
- no-transcript incomplete state
- provenance recorded

Completed on 2026-08-09. Captured text remains first priority. The anonymous adapter prefers a meaningful public title plus description. Only when that is insufficient and the confirmed duration is at most five minutes does it read public caption-track data and request the published timed-text resource. Longer or unknown-duration videos remain incomplete with their original link. It does not use login state, Cookies, OAuth, or restricted-media bypasses.

### Task-020 Bilibili Extraction

Same standard as Task-019 using the approved strategy from Task-003.

Completed on 2026-08-09. Added fixture-tested anonymous Bilibili detail, player-subtitle-list, and subtitle-body requests. A meaningful title plus description is used first; subtitle requests occur only for confirmed videos of at most five minutes. Longer/unknown-duration videos and missing or incomplete subtitles remain `incomplete_extraction`. Short-link normalization continues through the bounded URL service.

### Task-021 Xiaohongshu Extraction

Same standard as Task-019, including third-party credential disclosure where used.

Completed on 2026-08-09. Added opportunistic anonymous extraction of complete public note text from bounded page state, with metadata-only rejection. A separately tested custom-provider protocol is available only after explicit disclosure acceptance, a successful representative capability test, and SecretStorage resolution; no Cookie or platform credential is transmitted.

### Task-022 Douyin Extraction

Same standard as Task-019, including short-link normalization.

Completed on 2026-08-09. Douyin short links retain the bounded redirect normalization path. A meaningful title plus description may form the short card input. Otherwise a transcript may be accepted only from the explicitly disclosed, tested custom-provider protocol when it reports a duration of at most five minutes. Longer/unknown-duration videos and provider failures remain recoverable Inbox states with the source link.

### Task-023 WeChat Official Account Extraction

Acceptance:

- captured/full article text path
- generic fallback behavior explicit
- incomplete result remains visible in Inbox
- representative fixtures

Completed on 2026-08-09. Captured full text remains first, followed by the same bounded Readability/sanitization/Markdown path used for generic articles. A representative `mp.weixin.qq.com` fixture verifies complete article extraction; unavailable main text remains visible and retryable in Inbox, with the disclosed custom provider as the final optional fallback.

### Task-024 Foreground Processing Coordinator

Acceptance:

- concurrency one
- checkpointed stages
- resume after plugin reload
- missing network/config states
- final note committed before Inbox cleanup
- temporary source cleanup in every terminal path
- fixture end-to-end: Inbox URL → extract → generate → embed → classify → Markdown note

Completed on 2026-08-09. Added a single-run foreground coordinator with oldest-first selection, durable stage checkpoints, safe artifact reconstruction after reload, recoverable network/configuration states, idempotent note-commit boundary, and terminal cleanup only after the terminal Inbox result is durable. End-to-end fixtures cover extract → generate → embed → classify → canonical Markdown and verify that note commit precedes Inbox completion/cleanup.

### Task-025 Theme Classification

Acceptance:

- one suggested folder path
- existing folder reuse by normalized/similar name
- missing folders created safely
- note placed once
- user-moved note unchanged by regeneration

Completed on 2026-08-09. Added conservative normalized topic reuse, safe ordered folder creation, exactly-once initial placement, and regeneration behavior that leaves a user-moved note and its current topic unchanged.

Superseded for production storage on 2026-08-09. The service remains covered as isolated code, but the runtime no longer invokes it or creates AI classification folders. Canonical notes are committed directly under `Knowledge`, and filenames no longer append an ID/hash token.

### Task-026 Similar-Content Detection

Acceptance:

- different URLs compared through compatible embeddings
- warning with reason
- keep both or permanently delete either
- default keep both
- no merge path

Completed on 2026-08-09. Added OpenAI-compatible runtime embedding generation, validated finite vectors, deterministic model fingerprints, a derived plugin-data vector index, source hashes, and compatible-model/dimension cosine comparison. A high-similarity match opens a reasoned warning after the new Markdown note is committed. The default action keeps both notes; explicit irreversible actions can delete either note and remove its derived vector. No merge path exists. Embeddings remain optional and never block card creation when only Chat is configured.

## Cancelled V4 Roadmap

Tasks 027–031 and 033–038 are cancelled and replaced by the V5 Raw Review + Codex Wiki workflow. Do not implement them:

- keyword/Embedding index and hybrid search
- custom Map
- Today and Favorites
- topic move/reveal commands
- old regeneration comparison
- Markdown/PDF export
- topic/subtree deletion and Clear All

The completed historical code for Embeddings, Topic Folder, theme classification, and similar-content detection is removed in the V5 cleanup task; do not extend it.

### Task-027 Derived Keyword and Embedding Index — Cancelled by V5

Status: cancelled. Native Obsidian search and wikilinks replace the planned derived index.

### Task-028 Knowledge Search and List — Cancelled by V5

Status: cancelled. `SelfGrow Review` covers Raw selection; normal Obsidian views cover Wiki navigation.

### Task-029 Today View — Cancelled by V5

Status: cancelled with no replacement surface.

### Task-030 Favorites View — Cancelled by V5

Status: cancelled with no replacement surface.

### Task-031 Map View — Cancelled by V5

Status: cancelled. Obsidian's native graph renders Wiki wikilinks.

## Phase E — Raw Review and Codex Wiki

### Task-045 Freeze V5 Documentation

Acceptance:

- all six source-of-truth documents use Version 5.0
- Knowledge is consistently Raw and Wiki is consistently durable synthesis
- all 27 grilling decisions appear without contradiction
- cancelled V4 roadmap features are absent from active scope
- completed V4 work remains labeled as history

Completed on 2026-08-10. The 27 confirmed product decisions are reflected in all six V5 source-of-truth documents, `project_status.md`, and the README. This was a documentation-only pivot; no runtime or installed plugin artifact changed.

### Task-046 Raw Schema and Selection State

Acceptance:

- schema-v1 cards appear unselected and migrate safely to Raw schema v2
- `wiki_selected`, status, current hash, approved hash, distilled hash/time, targets, and safe error fields
- queue eligibility requires selected + queued + exact approved/current hash
- cancellation and renewed update approval invariants
- user-visible content hashing excludes operational metadata

Completed on 2026-08-10. Added `RawCardService` with schema-v1/default migration, schema-v2 validation, body-only SHA-256 hashing, exact-hash selection eligibility, cancellation, renewed update approval, flat-Knowledge containment, and Wiki-target containment. New AI and direct-material cards now start as unselected Raw schema v2. Workspace startup migrates existing completed cards, and Raw edits invalidate stale approval without hashing operational frontmatter. The complete gate passes 297 tests in 36 files; the production bundle is 491,604 bytes raw and 113,789 bytes gzip. Validated artifacts were installed to both desktop and iPhone/iCloud plugin directories with matching SHA-256 hashes.

### Task-047 Persistent Raw Images and Visual Preview

Acceptance:

- successful Raw retains every image under `SelfGrow/Attachments/`
- AI-routed images are not deleted after completion
- image-only cards receive one concise multimodal preview
- OCR alone is not treated as full visual understanding
- Raw deletion removes only unreferenced Raw attachments
- promoted assets under `Wiki/` survive Raw deletion

Completed on 2026-08-10. The canonical Raw committer now moves every successful AI-route image from `Inbox/Attachments` to persistent `SelfGrow/Attachments`, embeds the retained paths above the Raw summary, and includes those references in the body-only content hash. Image-only captures use one multimodal request for a validated single-sentence preview and concise title; OCR remains only a text fallback for non-image-only capture routes. Retry-safe image moves accept an already-retained destination and Inbox cleanup no longer removes successful Raw images. The complete gate passes 302 tests in 36 files; the production bundle is 495,104 bytes raw and 114,841 bytes gzip. Validated artifacts were installed to both desktop and iPhone/iCloud plugin directories with matching SHA-256 hashes.

No-vision fallback refined on 2026-08-10 after a live DeepSeek rejection. Visual preview failure no longer blocks Raw creation: SelfGrow uses the optional/user or original-image title, writes one honest sentence that the current model cannot describe the image, retains the original, and leaves visual understanding to Codex after user selection. The failed Inbox capture remains retryable without re-upload. The complete gate passes 303 tests; the production bundle is 495,886 bytes raw and 115,061 bytes gzip. Both plugin installations match the validated source artifact.

### Task-048 SelfGrow Review View

Acceptance:

- existing and new Raw cards appear
- sections for unselected, queued, completed, needs-update, and failed
- single and batch select/cancel/delete
- confirm-update action approves the current content hash
- completed cards remain selected until user cancellation
- no `excluded` state
- mobile, keyboard, VoiceOver, and 44 px targets
- handoff copy instructs the user to invoke Codex; no fake automatic launch

Completed on 2026-08-11. Added the mobile-compatible `SelfGrow Review / 知识筛选` ItemView and `Open knowledge review` command. Existing and new Raw cards are listed under unselected, awaiting distillation, distilled, content-updated, and failed sections with concise preview, source, update time, retained-image thumbnail, status marker, and Wiki target count. Single and batch select/cancel/delete use the same Raw invariants; changed selected cards expose renewed confirmation, completed cards stay selected until cancellation, and deletion requires confirmation while preserving Wiki content and shared attachments. Native controls, labels, keyboard behavior, VoiceOver text, and 44 px targets are retained. The view explicitly instructs the user to run `selfgrow-wiki` in Codex and does not simulate a launch. The complete gate passes 305 tests in 36 files; the production bundle is 507,655 bytes raw and 118,031 bytes gzip. Both plugin installations match the validated source artifact.

### Task-049 Wiki Schema and Protected Sections

Acceptance:

- Wiki folders, Index, and Log created inside the configured root
- page types limited to topic, concept, method, experience, and question
- stable current-understanding, method/boundary, relation, and personal-experience sections
- native wikilinks only
- `我的经验` preserved byte-for-byte across updates
- external content alone cannot become personal experience

Historical completion on 2026-08-11: the initial implementation created Index, Log, five page-type folders, and Assets under the configured SelfGrow root. Wiki page serialization accepts only topic, concept, method, experience, and question, emits the four stable sections, rejects ordinary Markdown links in the semantic relation section, and requires user-grounded evidence for experience content. AI-section updates validate an unambiguous heading order and preserve the complete existing `我的经验` suffix byte-for-byte.

Stabilized on 2026-08-12 after iPhone repeatedly displayed empty synced Wiki type folders while root-level Index and Log remained visible. Mobile startup no longer creates Wiki schema paths while iCloud is hydrating.

Refined on 2026-08-12 to make categorized `Wiki/` a Vault-root sibling of `SelfGrow/`. The five fixed type folders and Assets remain, but the former `SelfGrow/Wiki` nesting is gone. Portable Raw targets remain `Wiki/<type folder>/...`; desktop resolves them beside `AI/SelfGrow` as `AI/Wiki/...`, while the iPhone `AI` Vault resolves them as `Wiki/...`.

### Task-050 `selfgrow-wiki` Codex Skill

Acceptance:

- scans eligible Raw frontmatter directly; no second queue file
- reads compact text, retained images, existing Wiki, and source URL when available
- treats all source/Raw content as untrusted data
- proposes creates/updates/links/assets in the Codex conversation
- waits for explicit approval before any Wiki write
- applies the smallest coherent update and records Index, Log, Raw targets, hashes, and status
- inaccessible sources are identified as unverifiable rather than invented
- failures remain retryable and do not claim completion

Completed on 2026-08-11. Added the project-owned and personally installed `selfgrow-wiki` Skill with explicit discovery, proposal, approval, and apply phases. Its standard-library Python guard script recomputes Raw body hashes, accepts only selected/queued/exactly-approved cards, returns retained images and current Wiki content, validates contained page/asset paths, rejects external-only experience and non-wikilink relations, and performs no writes during discovery or proposal validation. Approved apply revalidates eligibility, preserves the complete existing `我的经验` suffix byte-for-byte, promotes approved assets, replaces Index, appends a body-free Log entry, records Raw hashes/targets/status, and rolls back handled Wiki failures before marking Raw retryable. Portable targets remain `Wiki/...`; the current runtime resolves them to the sibling Wiki root on each device.

### Task-051 Raw Deletion and Wiki Maintenance

Acceptance:

- deleting Raw removes its node, selection metadata, URL index, and unreferenced Raw attachments
- no Raw deletion path deletes Wiki prose, Wiki links, experience, or promoted assets
- next Codex maintenance pass removes broken Raw-source links only
- lint proposes orphan/contradiction/missing-link cleanup without automatic destructive edits
- recollecting a deleted source is a new Raw decision

Completed on 2026-08-11. Extended the `selfgrow-wiki` guard with a read-only maintenance report and an explicitly approved cleanup command. It recognizes only explicit missing `Knowledge/...` wikilinks, never deletes Wiki-to-Wiki links or promoted assets, and leaves the complete `我的经验` suffix unchanged. Orphan and missing-link findings are proposal-only; contradiction review remains semantic and non-automatic. The isolated self-test covers existing, missing, and recollected Raw targets, protected links, native Wiki links, and rollback-safe cleanup. A real read-only Wiki scan found no current broken Raw links, protected broken links, orphan pages, or missing Wiki links.

### Task-052 Remove Superseded Runtime

Acceptance:

- remove Embeddings settings/runtime/index and similar-content UI
- remove Topic Folder/theme-classification runtime and unused models
- remove regeneration-candidate, Favorites, Map/search, export, and Clear-All remnants
- preserve capture, extraction, compact generation, URL identity, Inbox, and Raw deletion
- no compatibility layer for cancelled features
- full tests/build and desktop/mobile artifact validation

Completed on 2026-08-11. Deleted vector connection/generation, derived index, similarity UI, Topic Folder, and theme-classification source and tests. Removed their settings, stored records, stages, generated-output fields, models, and error remnants, along with unused favorite/candidate/export/Clear-All contracts. The active pipeline is now `extracting -> generating -> completed` and commits directly to flat `Knowledge/`. Startup projects the previous settings container once and immediately persists only the current settings schema, discarding obsolete derived records without preserving a cancelled-feature runtime. Capture, extraction, compact generation, URL identity, Inbox, Raw review, and Raw deletion remain covered.

### Task-053 V5 End-to-End Validation

Acceptance:

- capture link, text, and pure-image Raw on desktop and iPhone
- existing Raw defaults to unselected
- select/cancel/update-confirm flows
- Codex proposal performs no pre-approval Wiki write
- approved batch creates/updates native linked Wiki pages
- protected experience survives updates
- delete Raw preserves Wiki and promoted assets
- native Obsidian graph shows Wiki-to-Wiki links
- production build and desktop/mobile artifact hashes pass

Completed on 2026-08-11. The full gate passes formatting, lint, source/test typechecking, 218 tests in 31 files, production build, Skill compilation/self-test, and official Skill validation. Prior user-observed desktop/iPhone capture checks cover links, shared text, and retained pure-image input; the user also verified selection/update behavior, approved Wiki creation, and native graph links. Automated boundaries prove no pre-approval Wiki writes, byte-preserved personal experience, Raw-only deletion, promoted-asset survival, and maintenance approval. The final production bundle is 489,609 bytes raw and 114,294 bytes gzip; source, desktop, and iPhone plugin copies match SHA-256 `3DAF0D9C0628D9984F86F835964A5F0566A5D42C687EAD3E50C53C37885EC5F4`.

### Task-054 Raw Categories, Markdown Preservation, and GitHub Sources

Acceptance:

- plugin startup idempotently creates `Raw/Project`, `Raw/Skill`, `Raw/Experience`; legacy folders and files are never deleted
- the Collect view offers only the three fixed categories (no free-form folder, no `Knowledge` default)
- the AI recognition card classifies `Project`/`Skill`/`Experience`, writes a noun-phrase title and one-sentence preview, and may list GitHub search terms; invalid output gets at most one constrained repair then a deterministic local fallback marked `recognition_source: local`
- `原始材料` preserves structured Markdown (headings demoted H1→H4/H2→H5 via mdast, fences/tables/lists/links/images intact, never a single blockquote)
- GitHub repository sources resolve owner/repo/default branch and select a language-matched README (explicit filenames → same-repo switch links → default), rewriting relative links/images to absolute URLs and recording README path/language
- bare repository/Skill names are completed via the GitHub Search API with unique-adopt / up-to-three-candidate confirmation / no-fabrication semantics; `Experience` is never force-searched
- a read-only `Scan raw folders` command reports before-count, per-category suggestions, unknown and conflict counts; migration stays an uninvoked, confirmable, rollback-capable capability
- no existing Raw file, user note, attachment, or Wiki content is modified or moved

Completed on 2026-08-16. Added the `RawCategory` domain, fixed category folder bootstrap, the three-way Collect selector with AI-suggested updates, the strict recognition card with one repair and local fallback, structured-Markdown Raw material (mdast-based heading demotion plus GitHub relative-link rewriting), the GitHub repository extractor with language-aware README selection, GitHub name completion with candidate confirmation, the read-only scan report command, and the uninvoked migration capability. The complete gate passes formatting, lint without warnings, all 250 tests in 34 files, source/test typechecking, and production build; the bundle is reported in `project_status.md`, and the artifacts were installed to both desktop and iPhone plugin directories with matching SHA-256 hashes. Real-device verification remains for iPhone GitHub candidate selection, multi-language READMEs, AI-fallback hints, and iCloud plugin reload.

### Task-055 Unified Personal Preference Profile

Acceptance:

- the Vault-local personal profile is the only personal scoring input for text/link and pure-image cards
- saving interested/uninterested topic bubbles creates or replaces only reserved manual profile signals and writes a new profile version
- topic-first then Agent-update preserves manual signals while adding reviewed project-derived signals
- Agent-first then topic-update preserves project-derived signals and source hashes while adding manual signals
- clearing topics removes only manual signals
- model prompts contain the complete profile but no parallel keyword scoring payload or keyword-match output fields
- invalid recommendation output never discards a valid core card; invalid full core receives one core-only repair, then local fallback
- historical Raw scores and profile versions are never silently rewritten

Implemented on 2026-08-25. Final gate, bundle, Skill self-test, and test-Vault installation results are recorded in `project_status.md` after validation.

### Task-032 Inbox View

Acceptance:

- all operational states
- safe error text
- retry and permanent delete
- completed items removed after knowledge commit
- processing progress without fake percentages

Completed on 2026-08-09. Added a mobile-safe operational Inbox service and ItemView covering all ten processing states with concise Chinese/English text and no fake percentages. Recoverable items expose retry with attempt/error reset; incomplete and failed items retain safe generic reasons; permanent capture deletion requires an explicit destructive confirmation and is constrained to reconciled Markdown inside the configured Inbox. Completion verifies the knowledge note exists, permanently removes the capture, then opens the committed Markdown note. Terminal cleanup preserves frontmatter/URL while removing captured body text. The synced layout `SelfGrow/Inbox/Inbox Queue.md` is explicitly excluded from capture adoption.

Refined on 2026-08-10. The Queue composer accepts a complete platform share message, extracts its first safe HTTP(S) link, and no longer requires a link. Supplied text and pure links use AI; only image-only/image-plus-link material without text is stored directly. Submit and Retry return after durable local state and start foreground processing asynchronously. The composer uses a responsive native-theme card with inline route feedback. Completed rows are not retained, and reconciliation purges a stale completed capture only after confirming its indexed knowledge note.

Personal-note boundary refined on 2026-08-10. The Queue composer now has one link/share-message/text field and no separate content-or-note field. Captured source bodies, URL-stripped share text, and OCR are temporary extraction/generation inputs only. New knowledge cards always initialize `我的笔记` / `My Notes` empty; only later user edits may populate it.

Failure fix on 2026-08-10: allowlisted platform short links no longer block durable capture when bounded resolution is offline, times out, or the Obsidian transport/API fails. The already safety-checked original short URL becomes the stable identity, while unsafe redirects still fail closed. Inbox submission now maps safe error categories to specific localized messages, and a presentation refresh failure cannot turn a committed capture into an action failure.

### Task-033 Note Commands and Editing Reindex — Cancelled by V5

Status: cancelled. Raw selection/update commands move to Task-048; Map, favorite, topic, regeneration, and Embedding reindex actions have no active contract.

Acceptance:

- favorite, reveal in Map, move, regenerate, permanent delete
- direct Markdown edits preserved
- file modifications debounce reindex
- searchable edits invalidate embeddings

### Task-034 Regeneration Comparison — Cancelled by V5

Status: cancelled. User-approved Codex proposals replace per-card regeneration candidates.

Acceptance:

- source re-extracted
- one candidate
- Current/Candidate mobile view
- explicit accept/reject
- personal note, folder, favorite, URL, and import time preserved
- rejected candidate deleted

### Task-035 Localization and Accessibility — Superseded by V5

Status: superseded. Relevant Chinese/English and accessibility acceptance moves to Task-048 and Task-053.

Acceptance:

- Chinese and English UI strings
- future generation follows selected language
- command palette access
- keyboard and mobile menu access
- VoiceOver labels and 44 px targets
- theme-compatible CSS

## Cancelled V4 Phase F

### Task-036 Markdown Export — Cancelled by V5

Status: cancelled; Markdown already resides in the Vault.

Acceptance:

- all or selected notes
- preserves Knowledge-root filenames
- secrets and temporary data excluded
- deterministic package contents

### Task-037 Mobile PDF Feasibility and Export — Cancelled by V5

Status: cancelled; do not add jsPDF.

First verify maintained Obsidian/mobile options before implementation.

Acceptance:

- selected approach documented with current API/library evidence
- Chinese and English rendering
- pagination and links
- verified on Obsidian iOS before marked complete
- no desktop-only false success

### Task-038 Permanent Deletion — Cancelled by V5

Status: cancelled. Task-051 owns individual Raw deletion; topic deletion and Clear All are removed.

Acceptance:

- note impact confirmation
- exact folder subtree counts
- permanent supported deletion path
- index/candidate/checkpoint cleanup
- two-confirm clear-all
- containment tests prove unrelated Vault files cannot be removed
- no SelfGrow Undo or restore

### Task-039 Plugin Settings and Extraction Disclosure

Acceptance:

- root path, language, Chat, Embeddings, extraction provider
- SecretComponent selectors
- connection tests
- third-party transmission explanation
- no account, cloud, notifications, or standalone-app settings

Completed on 2026-08-09. Added Obsidian 1.13 settings for root path, language, independent Chat and Embeddings provider/Base URL/model/SecretStorage selectors, connection tests, and editable official provider Base URL presets. Added local extraction as the default plus optional TikHub/Custom provider configuration using SecretComponent, explicit URL/identifier transmission disclosure, required acceptance, and a bounded capability test that rejects health-only responses unless representative article-body, platform-detail, and subtitle schemas all validate. Only secret names persist; no account, hosted-cloud, notification, platform-password, Cookie, or standalone-app controls were added.

### Task-040 Core End-to-End Desktop Validation — Superseded by V5

Status: superseded by Task-053. The V4 flow list below is historical and must not be implemented.

Flows:

- create/share-like Inbox note
- missing AI config then resume
- generic extraction
- generate, embed, classify, and move note
- Today, Map search, Favorites, Inbox
- edit and reindex
- regenerate accept/reject
- repeat URL import
- similar content warning
- Markdown export
- permanent note/subtree deletion
- clear all

Acceptance:

- production build succeeds
- typecheck and all tests pass
- installed in a desktop test Vault
- no private sample data committed

### Task-041 iPhone Installation Path

Research and select the simplest supported personal-plugin installation/update workflow from Windows to Obsidian iOS.

Acceptance:

- current installation method documented
- manifest, main.js, and styles.css delivered correctly
- no Mac or Apple Developer Program required
- update and rollback procedure
- dedicated test Vault backup

### Task-042 iPhone Share and Mobile Plugin Validation

Acceptance:

- SelfGrow Inbox Location works from iOS Share Sheet
- `SelfGrow Collect` appends a copied URL to the bookmarked queue without opening Obsidian
- bookmarked queue entries materialize into structured Inbox notes when the plugin loads
- copied Xiaohongshu and Weibo URLs complete the capture handoff
- Douyin-style shared text is normalized without adopting ambiguous notes
- offline capture
- plugin loads with `isDesktopOnly: false`
- no Node/Electron runtime error
- core views usable on iPhone
- processing pauses/resumes with Obsidian lifecycle
- SecretStorage works
- at least one real end-to-end URL completes

### Task-043 Priority-Platform Mobile Validation

Acceptance:

- representative Bilibili, YouTube, Xiaohongshu, Douyin, WeChat, and generic URLs
- captured-text/direct/provider path recorded
- incomplete states honest
- no real credential in reports
- known platform fragility documented

### Task-044 Personal Prototype Release

Acceptance:

- installable production plugin artifacts
- README with setup, Share Sheet Location, SecretStorage, foreground-processing limitation, backup, and permanent-deletion warning
- no stale standalone SelfGrow app claims
- Review selection and Raw cleanup usable on iPhone
- Codex Wiki handoff and native Obsidian graph workflow documented
- cancelled Map/search/Favorites/export/PDF/Clear-All features are not advertised
- remaining source/platform limitations reported honestly
