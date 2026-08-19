# SelfGrow Project Status

Last updated: 2026-08-19
Current product: SelfGrow for Obsidian  
Current phase: V5 feature development complete — stabilization, tuning, and bug fixing

## Current Collaboration Handoff (2026-08-19)

- GitHub collaboration is active through the private repository `https://github.com/Deeenia/SelfGrow`. The shared baseline is clean `main` at commit `2705884` (`feat: initialize SelfGrow collaboration repository`), matching `origin/main` when this handoff was written.
- Never implement directly on `main`. Start each scoped update from the latest `main` in its own branch, use `feature/android-compat` for the Android compatibility stream, `fix/<short-name>` for one defect, and `docs/<short-name>` for documentation-only work. Do not mix unrelated changes or overwrite a collaborator's edits.
- Before opening a pull request, inspect every changed file, run `npm run check`, run the SelfGrow Wiki Skill self-test when that Skill changes, and record any device-only validation that still needs the user or Android collaborator. Push the branch and merge through a reviewed pull request.
- Immediate collaboration priority is Android compatibility plus desktop/mobile behavior parity. Preserve the current iOS/iCloud and Obsidian behavior while fixing Android-specific filesystem, path, share-intent, rendering, lifecycle, and SecretStorage differences with the smallest platform boundary necessary.
- The proposed P0 foundation batch—category/folder separation, Raw re-extraction, diagnostics UI, and plugin/Skill contract checks—is explicitly deferred until the final product pass. Do not restore the deleted local branch `feature/p0-beta-foundations`, resurrect commit `25b5015`, or install that build unless the user explicitly reopens P0. Re-plan it from the then-current `main` so collaborator work is included.
- Repository work is owned by the primary OpenAI agent under `D:\Brainstorming\AGENTS.md`. Do not invoke or spawn DeepSeek, and do not create `.codex/deepseek-worker-task.md`, unless the user explicitly confirms an override of that repository rule.
- Do not install a plugin build into a live Vault, modify iCloud state, push a branch, or merge a pull request merely to prepare a handoff. Those actions require the corresponding user request and must follow validation.

## 0. Latest stabilization pass (2026-08-17)

- Collection folders are now extensible: `Project`, `Skill`, and `Experience` remain the built-in choices, while any valid first-level Raw folder is listed and can be created directly from Collect. Internal `Inbox` and `Attachments` paths remain protected.
- Ambiguous GitHub-name selection now closes immediately after a choice, writes the selected repository back into the link field, and waits for a second explicit Save before capture. Candidate names/descriptions wrap and clamp safely on narrow mobile dialogs.
- GitHub README retrieval now accepts up to 5 MB and handles Markdown language-switch links with optional titles, while preserving the selected target-language README when available.
- Validation after this pass: all 250 tests in 34 files passed; production typecheck and bundle build passed; lint passed.
- README rendering now keeps the extracted Markdown source unchanged in the Raw note. Obsidian renders the original headings, lists, tables, code blocks, links, and images directly; the note parser only treats SelfGrow's outer section headings as structure.
- GitHub README normalization now removes only Obsidian-incompatible layout wrappers, rewrites relative GitHub assets to renderable URLs, detects language-switch labels such as `中文/简体`, and rejects low-signal license or author text from recognition previews.
- Capture input now accepts protocol-less GitHub links, converts explicit `owner/repo` names directly to repository URLs, and adds exact `repo:` search queries for repository-name matching.
- GitHub README capture now recovers from unavailable API/raw hosts by extracting the repository page's rendered README, isolates `article.markdown-body` from large GitHub pages, and probes only the target-language and default README concurrently when the API is unavailable. This removes the prior many-candidate serial timeout and restores previously working repository links. Validation: formatting, lint, typechecking, all 260 tests in 34 files, and the production build passed. Both iCloud plugin copies match the source bundle SHA-256 `EFBAE9EE3B6A0CD859A8B533C5761756D508B77F0EE11395D7F99BD4A1EC6A86`.
- AI Raw recognition now accepts concise valid Chinese previews from 20 characters instead of rejecting everything below 40 characters. When a configured AI endpoint returns an HTTP error or two invalid cards, processing now reports a visible retryable Inbox failure instead of silently committing an unsummarized local title and source excerpt. Validation: formatting, lint, typechecking, all 261 tests in 34 files, and the production build passed. Source and both iCloud plugin bundles match SHA-256 `4DAE65D3A4AF166835A72E053984752AEEC073CE5E087E7B2D7E39C0CCE620B4`.
- Raw recognition policy is now explicit: pure images and transcript videos may retain their dedicated local/visual treatment, while every other source requires an AI-generated title and selection preview. A production Vault with missing chat configuration or SecretStorage credentials now remains retryable in Inbox instead of silently writing `recognition_source: local`. Validation: formatting, lint, typechecking, all 263 tests in 34 files, and the production build passed. Source and both iCloud plugin bundles match SHA-256 `6F3FEC47165A278A5CD458FBC242344D5D4D361D61F5EA6AF8ECAB35425BA241`.
- GitHub Markdown normalization now repairs same-repository raw image URLs containing a duplicated branch segment such as `/main/main/`, converts standalone HTML `<img>` tags to stable Markdown images, and removes multiline HTML comments outside fenced code. This prevents broken README images, literal image tags, and hidden source/footer blocks from appearing in Raw notes. Validation: formatting, lint, typechecking, all 266 tests in 34 files, and the production build passed. Source and both iCloud plugin bundles match SHA-256 `E31BED130BA7334D8279DDB11BCACC32BB59660CBB4B8B5CE2B63002901E0D4C`.
- GitHub Raw material is now normalized a second time at the shared generation boundary, independent of whether extraction used the Contents API, raw host, or rendered-page fallback. A real-note regression test verifies duplicated raw branches and hidden comment blocks cannot reach committed source material. Validation: formatting, lint, typechecking, all 267 tests in 34 files, and the production build passed. Source and both iCloud plugin bundles match SHA-256 `3BA1B239400C41C52F63DE2BECC7F1A41E6B081A813D05E69C7F4838F6D5AF07`.

## 1. Current Outcome

SelfGrow is a local-first, mobile-compatible Obsidian plugin with a validated capture pipeline. V5 changes the product from a pile of isolated cards into a user-curated, Codex-distilled AI Wiki:

```text
Capture a link, share message, text, or images
→ save one Raw evidence card under configurable Raw/Knowledge
→ user reviews it in SelfGrow Review and explicitly selects it
→ user opens Codex and invokes the Wiki distillation skill
→ Codex proposes linked Wiki changes and waits for confirmation
→ approved Topics, Concepts, Methods, Experiences, and Questions grow in fixed type folders under the sibling Wiki/
→ Obsidian's native wikilinks and graph show the knowledge network
```

The capture/extraction baseline, desktop validation, and iPhone/iCloud validation are complete. Knowledge storage remains flat, but V5 defines every `Knowledge/<article title>.md` file as low-density Raw material rather than final knowledge. Existing cards begin unselected so tests can be deleted before they influence the Wiki. Tasks 046–053 implement Raw review, retained images, the protected Wiki schema, approved Codex distillation, Raw-safe maintenance, obsolete-runtime removal, and end-to-end validation.

The first real approved Wiki batch completed on 2026-08-11 in the active iCloud Vault. Three Raw cards produced `Coding Agent Skills 选型`, `软件系统架构模式`, and `Agent 应用开发学习路径`; the architecture image was promoted byte-identically, Index and Log were updated, and all three Raw hashes/targets were marked completed. The current stabilized layout places categorized `Wiki/` beside `SelfGrow/` at the Vault root.

As of 2026-08-13, text/link capture no longer performs a second AI summary before Wiki distillation. It writes the extracted title, a deterministic one-line selection preview, and the complete extracted article body or transcript into the Raw card. Pure-image capture keeps its optional visual-preview path and retained original. Full AI interpretation, synthesis, categorization, and linking now have one owner: the explicitly approved `selfgrow-wiki` workflow.

The Raw-evidence refinement passes formatting, lint, source/test typechecking, all 203 tests in 29 files, production build, Skill self-test, and official Skill validation. The production bundle is 481,925 bytes raw and 111,972 bytes gzip. Source, desktop, and iPhone plugin artifacts match SHA-256 `528D870BA9A2F555B9EBDD9A1C15B8E746C1E9343AA46EDFFCAF06791DED8B9F`; both existing `data.json` files were preserved. The installed personal `selfgrow-wiki` Skill matches project source SHA-256 `14FE94CA6265938F47D9133232414002B6FDCE124AC526EAB954CE653F2BBC62`.

The current navigation/storage refinement makes Collect and Review equal one-tap destinations, separates link and body input, accepts up to 20 mixed local files with multiple images, and retains non-image files as evidence. The root layout becomes sibling `SelfGrow.md`, configurable `Raw/`, and `Wiki/`; startup safely renames the legacy terminal `SelfGrow/` root and moves its legacy queue file when the destination is unoccupied.

This refinement passes formatting, lint, source/test typechecking, all 204 tests in 29 files, production build, Skill self-test, and official Skill validation. The production bundle is 485,851 bytes raw and 113,192 bytes gzip. Source, desktop, and iPhone plugin bundles match SHA-256 `E45A2B812654E2A0BE9AC6A352637C5910F5E4FAA6434A729E449F41A765B43E`.

The Collect folder refinement moves destination choice into the capture form. `Knowledge` remains the default stream-platform collection, while any existing first-level Raw folder can be selected and a missing valid name is created on save. Raw review, URL identity, deletion, and Wiki discovery now include every first-level collection folder. The link field again accepts full promotional share copy, extracts the first HTTP(S) URL, and retains the surrounding text with the separate body field.

The folder/share refinement passes formatting, lint, source/test typechecking, all 205 tests in 29 files, production build, Skill self-test, and official Skill validation. The production bundle is 487,814 bytes raw and 113,893 bytes gzip. Source, desktop, and iPhone plugin bundles match SHA-256 `9B617D850663A248256E36055EC376891AE093E5617B7FE6D1DE3DA691513A4D`. Live migration has completed to sibling `SelfGrow.md`, `Raw/`, and `Wiki/`; desktop and mobile settings resolve to `AI/Raw` and `Raw` respectively.

Collection presentation now keeps internal machinery out of the normal user experience. Managed Inbox capture folders are hidden in the file explorer, raw capture properties/titles are hidden if opened indirectly, and friendly state/actions remain in the SelfGrow Inbox view. Completed Knowledge notes also hide Obsidian's raw properties panel and filename-derived inline title while retaining the canonical Markdown heading and readable sections. The queue accepts both the Shortcut's timestamped task and a desktop-pasted bare URL or unchecked URL task; desktop entries are durably timestamped by the plugin before materialization, so the user never types a time.

AI-created classification folders have been removed. Existing cards were migrated to the Knowledge root, and canonical filenames now use only the sanitized article title with no UUID/hash suffix. A conflicting different note with the same title fails safely instead of adding a number.

## 2. MVP Fast-Track Development Stages

Development now follows this staged order so the first usable iPhone-to-Obsidian loop is validated as soon as possible:

| Stage                     | Timing    | Scope                                                                                                                                 |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Phase C                   | Completed | Tasks 009–013: establish the reliable Vault data path                                                                                 |
| Phase D core              | Completed | HTTP, Chat, generation schema, generic-article extraction, and the processing coordinator                                             |
| Minimum product entry     | Completed | Minimal settings UI, Inbox status, lifecycle composition, and opening the generated Markdown note                                     |
| Desktop validation        | Completed | Real iCloud Vault, queue wakeup, honest incomplete source, missing-AI recovery, SecretStorage, canonical note, and reload persistence |
| iPhone validation         | Completed | Same synced Vault and flat Knowledge layout confirmed on desktop and iPhone                                                           |
| Phase D retained baseline | Completed | YouTube, Bilibili, Xiaohongshu, Douyin, and WeChat extraction                                                                         |
| V5 documentation          | Completed | Task-045: Raw selection, Codex confirmation, Wiki schema, deletion semantics, and scope cancellation                                  |
| V5 Raw review             | Completed | Tasks 046–048: schema, retained images, and SelfGrow Review                                                                           |
| V5 Wiki schema            | Completed | Task-049: contained folders, fixed page types, native-link sections, and byte-preserved `我的经验`                                    |
| V5 Codex loop             | Completed | Task-050: eligible Raw discovery, visible proposal, explicit approval, contained transactional apply                                  |
| V5 Wiki maintenance       | Completed | Task-051: broken Raw-link cleanup and non-destructive lint behavior                                                                   |
| V5 cleanup and validation | Completed | Tasks 052–053: cancelled runtime removed and complete loop/artifacts validated                                                        |

The MVP gate is complete. Video handling now follows the user's compact-card preference: meaningful title plus description first; only an insufficient description triggers transcript retrieval, and only for a confirmed duration of at most five minutes. Longer or unknown-duration videos stay in Inbox with the original link.

Execution rules:

- Deliver work by the stage shown above. Numbered task boundaries and acceptance criteria remain the internal completion units within each stage.
- Prioritize work that blocks the MVP gate; defer the explicitly listed remainder until its stage.
- The six V5 documents remain authoritative for contracts, dependencies, and acceptance criteria.
- Never mark a numbered task complete unless its documented acceptance criteria are fully met. If a later task combines MVP and deferred scope, update the plan explicitly before implementing or claiming completion.
- Update this file with consolidated evidence and a refreshed new-window prompt after each completed stage.

## 3. Source of Truth

Read these six documents completely before implementation:

1. `docs/product-spec.md`
2. `docs/system-architecture.md`
3. `docs/design-system.md`
4. `docs/database-schema.md`
5. `docs/api-contracts.md`
6. `docs/development-tasks.md`

Supporting research:

- `docs/research/task-003-extraction-feasibility.md`
- `docs/research/task-004-dependency-evaluation.md`

The old prototype image is visual reference only and is not authoritative for the Obsidian product shell.

## 4. Completed Tasks

### Task-001 — Freeze V4 Documentation

Completed.

- Six source-of-truth documents use SelfGrow for Obsidian and Version 4.0.
- Standalone Swift/iOS app, backend, account system, Explore tab, graph cross-links, and SQLite source-of-truth are removed from the active design.
- Vault Markdown is the persistent knowledge source of truth.
- The eight mandatory Chinese engineering rules are preserved in `development-tasks.md`.

### Task-002 — iOS Capture and Shortcut Spike

Completed and tested on the target iPhone.

The Apple Shortcut `SelfGrow 收集` performs:

```text
Get Clipboard
→ Get URLs from Clipboard
→ Get First Item
→ Current Date
→ Format Date once as yyyyMMdd-HHmmss
→ construct one Markdown queue line
→ Obsidian: Capture to Bookmark
```

Bookmark target:

```text
SelfGrow/Inbox Queue.md
```

Exact queue grammar:

```markdown
- [ ] <yyyyMMdd-HHmmss> <single-http-or-https-url>
```

The Shortcut runs from iOS Control Center and appends in the background without opening Obsidian. Xiaohongshu, Bilibili, Weibo, and Douyin were validated. The queue parser must select one HTTP(S) URL and reject `mailto:`, multiple URLs, trailing payloads, malformed dates, and checked entries.

The plugin will acknowledge a queue entry only after it has safely materialized a durable Inbox note.

### Task-003 — Extraction Feasibility Spike

Completed on 2026-08-07.

Observed real fixtures:

| Source                      | Result                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Xiaohongshu image/text note | Complete title and caption were anonymously available through undocumented page state; usable but not a stable product contract |
| Bilibili video              | Metadata available, but the sample had no subtitles; incomplete                                                                 |
| Weibo post                  | Redirected to visitor verification; incomplete                                                                                  |
| Douyin video                | Title/description available, but no transcript; incomplete                                                                      |
| Generic public article      | Complete through direct HTML extraction and Reader-service comparison                                                           |

Decisions:

- The first complete end-to-end extractor is a generic-article path using Obsidian `requestUrl`, bounded HTML, a non-executing DOM parser, Mozilla Readability, a sanitizer, and completeness validation.
- Metadata, descriptions, thumbnails, comments, danmaku, and media/play URLs do not count as complete content.
- Videos require usable subtitles or a transcript. Otherwise the result is `incomplete_extraction`.
- Anonymous platform adapters are opportunistic and isolated behind `ContentExtractor`.
- TikHub is the initial configurable third-party social extraction provider candidate, not a hard-coded dependency.
- Provider activation requires a real capability test for response schema, article body, platform details, and subtitles—not only a health check.
- Platform Cookies are never sent automatically.

### Task-004 — Dependency Evaluation

Completed on 2026-08-09 without installing packages or scaffolding code.

Selections:

- Zod 4 for runtime schemas, initialized through one jitless boundary.
- Native WebView `DOMParser`, Mozilla Readability, Obsidian `sanitizeHTMLToDom`, and Obsidian `htmlToMarkdown` for generic articles.
- `mdast-util-from-markdown` source positions for safe generated-section replacement.
- MiniSearch with deterministic Chinese/English tokenization for the keyword index.
- jsPDF only as the Task-037 iPhone feasibility candidate; it is not added before that task, and PDF remains unsupported until mobile validation.
- Vitest, jsdom, and an injected fixture transport as development-only test infrastructure.

Rejected duplicate or unsuitable runtime choices include jsdom/happy-dom/linkedom, DOMPurify, Turndown, full remark, FlexSearch, Lunr, pdf-lib, Nock, and MSW. Full evidence is in `docs/research/task-004-dependency-evaluation.md`.

### Task-005 — Scaffold Plugin

Completed on 2026-08-09.

- Plugin/package ID: `selfgrow`; install folder: `.obsidian/plugins/selfgrow/`.
- Version 0.1.0, minimum Obsidian 1.13.0, and `isDesktopOnly: false`.
- Minimal `src/main.ts` contains empty lifecycle methods and no product registration.
- TypeScript, esbuild, Prettier, ESLint with Obsidian rules, and Vitest are configured.
- Production build metadata records raw/gzip size and rejects Node/Electron imports.
- `npm run check` passed format checking, lint, 3 tests, source/test typechecking, and production build.
- Production `main.js`: 602 bytes raw, 408 bytes gzip.
- The Task-005 npm installation audit reported zero known vulnerabilities; no production dependency existed at that scaffold milestone.
- The scaffold itself registered no domain model, command, view, setting, or product behavior; Tasks 006–008 subsequently added foundation modules without changing lifecycle registration.

### Task-006 — Test Harness and Mock Obsidian Boundary

Completed on 2026-08-09.

- Added narrow mobile-safe ports for Vault text operations, metadata/frontmatter, SecretStorage resolution, HTTP, and injected time/timezone.
- Added development-only in-memory Vault and frontmatter adapters; their filesystem fixture loader remains under `tests/` and cannot enter the mobile runtime bundle.
- Added an exact method-and-URL fixture HTTP transport that never accesses the network, rejects unknown requests, deep-copies responses, records call order with Authorization/Cookie redaction, and models response, redirect, timeout, and oversized-body outcomes.
- All test secret values are explicitly marked invalid and synthetic.
- Added a sample fixture Vault containing a synthetic Inbox queue/capture and `.obsidian/plugins/selfgrow/` manifest, bundle, and stylesheet.
- `npm run check` passed format checking, lint, 12 tests, source/test typechecking, and production build.
- Production `main.js` remained 602 bytes raw and 408 bytes gzip; no test adapter, Node API, domain model, or product behavior entered the bundle.
- No dependency was added. jsdom remains deferred until a DOM-dependent task actually requires it.

### Task-007 — Domain Models and State Machine

Completed on 2026-08-09.

- Added branded SelfGrow ID and Vault path types so the two string identities cannot be mixed accidentally.
- Added explicit Chinese/English languages, seven source platforms, all 10 processing states, generated knowledge, recursive topics, note summaries, favorites, regeneration candidates, and the documented stable error-code union.
- Favorite is a discriminated union: an unfavorited note cannot carry a favorite timestamp.
- The closed transition table defines legal progress, waiting, failure, incomplete-extraction retry, and terminal completion behavior.
- Exhaustive tests check every possible destination from every processing state.
- No `any`, persistence behavior, settings, or later product feature was added.
- `npm run check` passed 29 tests; `main.js` remained 602 bytes raw and 408 bytes gzip.

### Task-008 — Settings and Secret References

Completed on 2026-08-09.

- Added independent Chat and Embeddings settings for OpenAI, DeepSeek, Qwen, and Custom presets.
- Endpoint metadata contains only Base URL, model, and SecretStorage name. Actual secret values are resolved by reference only at request time through the Obsidian SecretStorage adapter.
- Editing preset, Base URL, model, or secret name invalidates only that endpoint's successful connection-test metadata. Validated loading also invalidates stale persisted tests.
- Added one Zod 4.4.3 boundary configured with `jitless: true` before strict schema construction. Unknown persisted fields, including attempted embedded secret values, are rejected.
- Added explicit owned-secret registration and clear-all planning: SelfGrow-owned names are selected for deletion, while shared referenced names are preserved and reported.
- Persisted settings and safe log summaries contain no secret values.
- Zod was the only added production dependency. Installation audited 376 packages with zero known vulnerabilities.
- `npm run check` passed formatting, lint, 41 tests, source/test typechecking, and production build.
- The Phase B modules are not yet composed into plugin lifecycle behavior, so `main.js` remained 602 bytes raw and 408 bytes gzip. Composition belongs to the relevant product tasks.

### Task-009 — Path Guard and URL Normalization

Completed on 2026-08-09.

- Added normalized SelfGrow-root containment and strict descendant checks through an injected Obsidian `normalizePath` boundary.
- Rejects traversal, sibling-prefix, invalid, credential-bearing, local, private-network, and non-HTTP(S) targets.
- Removes fragments and known tracking parameters without deleting content identifiers.
- Classifies all supported platforms and resolves approved short hosts through exact HTTP fixtures with redirect safety.
- Repeated URL forms produce one normalized identity.

### Task-010 — Knowledge Note Parser and Serializer

Completed on 2026-08-09.

- Added strict canonical frontmatter validation and mdast source-position parsing.
- Chinese and English fixtures round-trip deterministically.
- Personal Markdown is preserved from the original byte ranges; fenced-code headings do not become section markers.
- Missing, duplicated, reordered, raw-source, empty, and mismatched-source notes fail safely without rewriting.
- Added `mdast-util-from-markdown` 2.0.3, the dependency selected by Task-004.

### Task-011 — Inbox Reconciliation

Completed on 2026-08-09.

- Parses only exact unchecked bookmark tasks with a valid local timestamp and one HTTP(S) URL.
- Materializes a deterministic Inbox file and complete frontmatter before acknowledging its queue line.
- Restarting reconciliation reuses the same capture; missing IDs use browser UUIDs and valid legacy timestamps use Vault `ctime` only as fallback.
- Structured captures and constrained single-URL shared text are adopted oldest first; unrelated, ambiguous, unsafe, and malformed notes remain untouched.
- Existing indexed URLs are explicitly returned as re-imports.

### Task-012 — URL and Note Indexes

Completed on 2026-08-09.

- Added rebuildable normalized-URL and SelfGrow-ID maps scoped to `SelfGrow/Knowledge/`.
- Create, note move, folder rename/move, note delete, and subtree delete update the index without rescanning.
- Duplicate URL/ID/path updates fail before mutation and preserve the existing index.
- Re-import changes only `imported_at`; body, folder, favorite, and identity remain unchanged.
- Derived snapshots are deterministic, schema-versioned, strictly validated, and contain no note body or secret.

### Task-013 — Topic Folder Service

Completed on 2026-08-09.

- Added multiple sorted topic roots, recursive child folders, and completed-note summaries backed directly by Vault folders.
- Create, rename, topic move, and note move enforce portable names, exact Knowledge-root containment, path types, destination availability, and cycle prevention.
- Successful moves emit incremental URL-index events.
- Deletion impact reports exact descendant-folder and completed-note counts but performs no deletion.
- No `_topic.md` metadata file is created.
- Added production Obsidian Vault/FileManager/MetadataCache/frontmatter adapters; no raw filesystem API is used in mobile code.

### Task-014 — Obsidian HTTP Transport

Completed on 2026-08-09.

- Added a production `ObsidianHTTPTransport` that uses Obsidian `requestUrl` with `throw: false`; it forwards only the documented GET/POST request contract and defensively copies request headers.
- Reused the Phase C URL policy for initial targets and visible redirect `Location` values, including relative redirect resolution and rejection of credentials, non-HTTP(S), local, and private targets.
- Validates positive finite timeout and response limits before dispatch, races requests against an explicit timeout, and checks `arrayBuffer.byteLength` before accessing response text.
- Maps timeout, request, response-shape, and size failures to existing typed safe errors without persisting raw external error messages, headers, bodies, secrets, or full URLs.
- The fixture transport retains exact method/URL matching, no-network operation, defensive copies, ordered redacted calls, and synthetic timeout/oversize outcomes while adding shared URL/limit/redirect checks and real UTF-8 body bounds.
- Focused tests cover default `requestUrl` usage, forwarding and immutability, exact/oversized UTF-8 limits, invalid limits, unsafe initial targets, safe relative and unsafe redirects, late request rejection after timeout, safe error redaction, and fixture parity.
- `npm run check` passed formatting, lint without warnings, 104 tests, source/test typechecking, and production build.
- Production `main.js` remained 602 bytes raw and 408 bytes gzip because the adapter is not yet composed into plugin lifecycle behavior.
- Public `requestUrl` has no cancellation option and exposes no redirect-control/final-URL field. The adapter safely discards late settlement and validates every 3xx `Location` it can observe; actual automatic-redirect visibility remains an Obsidian desktop/mobile integration check.

### Tasks 015–017 — AI Connection and Generation Contract

Completed on 2026-08-09.

- Added independent OpenAI-compatible Chat and Embeddings probes with per-request SecretStorage resolution, bounded requests, strict response checks, deterministic fingerprints, and safe localized failures.
- Added a strict bounded generation schema for title, summary, core knowledge, one portable theme path, source language, and requested output language.
- Added the V1 source-grounded Chinese/English prompt using exactly one system and one user message. The complete source is serialized as untrusted JSON data and adversarial instructions cannot alter the contract.

### Task-018 — Captured Text and Generic Article Extraction

Completed on 2026-08-09.

- Complete captured Markdown wins without an HTTP request; metadata-only captures fall through honestly.
- Generic public pages use bounded HTML, a non-executing DOM, Mozilla Readability, Obsidian sanitization/Markdown conversion, canonical URL validation, complexity limits, and completeness checks.
- Headings, lists, and code survive where meaningful; scripts, handlers, and unsafe markup do not.
- Added `@mozilla/readability` 0.6.0 as a production dependency and jsdom 29.0.0 plus types as test-only dependencies. The installation audit reported zero known vulnerabilities across 448 packages.

### Task-025 — Theme Classification

Completed on 2026-08-09.

- Reuses an existing topic through conservative Unicode/case/separator normalization, creates missing segments safely in order, and moves an initially generated note exactly once.
- Regeneration returns the current topic/note without reading, creating, or moving folders, so a user-moved note remains authoritative.

### Task-024 — Foreground Processing Coordinator

Completed on 2026-08-09.

- Added oldest-first, single-concurrency foreground execution with durable extracting/generating/embedding/classifying checkpoints.
- Reload recovery safely reconstructs non-persisted artifacts and advances from the durable stage; no raw source or provider response becomes hidden persistent state.
- Network and AI configuration failures remain recoverable waiting states. Incomplete and failed terminal paths retain safe diagnostic text and clean temporary input only after the terminal Inbox result is durable.
- The canonical note commit occurs before Inbox completion/cleanup. A finalization failure preserves the Inbox item and temporary input for an idempotent retry.
- Fixture end-to-end coverage proves Inbox URL → extract → generate → embed → classify → canonical Markdown note.
- Phase D core `npm run check` passed formatting, lint without warnings, 20 test files and 225 tests, source/test typechecking, and production build. The still-uncomposed `main.js` remains 602 bytes raw and 408 bytes gzip.

### Task-039 — Plugin Settings and Extraction Disclosure

Completed on 2026-08-09.

- Added Obsidian 1.13 settings for the configurable Vault-relative root, Chinese/English language, and independent Chat and Embeddings preset/Base URL/model/SecretStorage references.
- OpenAI, DeepSeek, and Qwen presets prefill editable official Base URLs; endpoint edits invalidate only the affected successful test.
- Added local extraction as the default plus optional TikHub/Custom provider settings. Third-party transmission requires explicit disclosure acceptance before testing or activation.
- Extraction capability testing is bounded and rejects a health-only response unless representative article-body, platform-detail, and subtitle response schemas all validate.
- Persisted settings contain secret names only. No account, hosted-cloud, notification, platform-password, Cookie, or standalone-app settings were introduced.

### Task-032 — Inbox View

Completed on 2026-08-09.

- Added an operational ItemView with Chinese/English text for all ten states, honest current-step labels, safe concise errors, and no fake percentages.
- Recoverable waiting/incomplete/failed states support retry; retry increments attempts and clears only prior safe error/checkpoint fields.
- Permanent capture deletion requires an explicit destructive confirmation and is constrained to a reconciled Markdown file below the configured Inbox.
- Completion verifies the knowledge note exists, removes the Inbox capture, then opens the committed Markdown note. Captured body cleanup occurs only after a durable terminal state and preserves frontmatter plus source URL.
- Inside the user's `AI` repository folder, the queue remains `SelfGrow/Inbox Queue.md`; because desktop Obsidian currently registers the parent iCloud container as its Vault, the Obsidian API path is `AI/SelfGrow/Inbox Queue.md`. The queue is never adopted as a capture.

### Minimum Product Entry Integration

Completed on 2026-08-09.

- Replaced the empty scaffold lifecycle with production composition after `workspace.onLayoutReady`; `onload()` registers settings, command, view, and the scoped Vault create event without beginning processing early.
- Added validated OpenAI-compatible generation, canonical knowledge-note commit/frontmatter/index behavior, deterministic retry-safe filenames, and automatic opening of the completed Markdown note.
- The pipeline drains eligible captures oldest first while Obsidian is active and responds to new Inbox files. Vector persistence/search remains explicitly deferred; the MVP coordinator retains its embedding checkpoint without pretending that deferred vector indexing is complete.
- Updated the production size gate from the historical 50 KiB empty-scaffold budget to a 750 KiB product-entry budget while retaining the Node/Electron mobile-import rejection.
- Historical product-entry validation passed formatting, lint, 26 test files and 252 tests, source/test typechecking, and production build. Its former two-level storage policy is superseded by the flat-Knowledge refinement recorded below.
- Obsidian `requestUrl` can internally follow an approved short link and expose only an oversized destination body. URL normalization now retains the already safety-checked allowlisted short URL only for this response-too-large condition; unsafe redirects and all other normalization failures still fail closed.
- Foreground state validation uses direct `Vault.read()` of current Markdown frontmatter instead of MetadataCache or `cachedRead()`, preventing a freshly written state from being mistaken for a stale predecessor during selection or transition.
- Production lifecycle now observes modifications to both supported queue-note paths, so appending an unchecked entry to an existing synced queue immediately wakes reconciliation without a plugin reload.
- The user confirmed that desktop and mobile share the Vault through cloud sync. Vault files are common, but plugin installation and SecretStorage availability must still be validated per device; simultaneous processing on both devices is not assumed safe.

## 5. V5 Fixed Product Scope

- Personal local prototype for one user.
- Obsidian community plugin developed on Windows with TypeScript.
- Mobile compatible: `isDesktopOnly: false`.
- iPhone and iOS 18 are the first mobile target.
- No Mac, Xcode, Apple Developer Program, custom Share Extension, or SelfGrow server is needed.
- Queue import accepts a bare link, a complete share message containing a link, text without a link, and up to three images.
- Priority sources: generic articles, YouTube, Bilibili, Xiaohongshu, Douyin, and WeChat Official Accounts.
- Weibo may use the generic/provider pipeline but is not an original priority adapter.
- Chinese and English UI/output.
- `SelfGrow/Knowledge` remains the flat Raw collection; the Vault-root sibling `Wiki/` is the categorized distilled layer.
- Existing Knowledge cards are unselected Raw candidates by default.
- Raw cards store only a compact AI summary, source link, user-owned `我的笔记`, and original images. Extracted bodies, URL-stripped share copy, and OCR text are not persisted as notes.
- Every Raw card exposes `wiki_selected`, distillation status, approved content hash, distilled hash, and Wiki targets in frontmatter. The Raw card itself is the queue; there is no second Wiki queue file.
- Editing a selected or distilled Raw card invalidates prior approval. It cannot be distilled again until the user confirms the changed version.
- Deselection cancels future eligibility and invalidates an unapproved proposal; it does not delete Raw or existing Wiki pages.
- Codex revisits a reachable source URL during distillation. If the source is unavailable, it may use the compact Raw summary only when the proposal is visibly marked unverifiable.
- Experiences may come only from `我的笔记`, an explicitly identified experience Raw card, or explicit confirmation in the Codex conversation. External content alone never creates personal experience.
- Wiki page types are Topics, Concepts, Methods, Experiences, and Questions. All connections are ordinary Markdown wikilinks rendered by Obsidian's native graph.
- Codex presents proposed Wiki changes in the Codex conversation and waits for confirmation. The plugin does not launch Codex or implement a second diff UI.
- Wiki pages contain `当前认识`, `方法与边界`, `关联`, and the protected `我的经验` section. Codex never overwrites user content in `我的经验`.
- All Raw images are retained with the Raw card. Wiki-required images are copied directly under the sibling `Wiki/`; otherwise they are removed when their Raw card is deleted.
- Deleting Raw immediately removes its Raw node and never deletes distilled Wiki knowledge. Broken Raw references are cleaned during the next Codex maintenance pass while Wiki prose survives.
- After successful distillation, the user may manually delete reviewed Raw cards from a cleanup list. There is no automatic deletion prompt.
- Cancelled from the active roadmap: custom Map, Today, Favorites, custom keyword/vector search and embeddings, AI classification folders, similar-content warnings, regeneration, export/PDF, Clear All, graph database, edge table, Canvas, and custom graph rendering.

## 6. Technical Invariants

- Use Obsidian Vault, FileManager, metadata/frontmatter, SecretStorage, and `requestUrl` APIs.
- Do not use Node.js, Electron, raw `fs`, or `path` in mobile runtime code.
- `onload()` stays fast; processing begins after `workspace.onLayoutReady`.
- Processing runs only while Obsidian and the plugin are active and resumes from safe checkpoints.
- Initial processing concurrency is one.
- External and frontmatter data require runtime validation.
- Never log article bodies, transcripts, personal notes, API Keys, tokens, Cookies, share tokens, or raw provider responses.
- Chat configuration remains OpenAI-compatible and secret-backed. Embeddings are not part of the active V5 architecture.
- User edits are authoritative and are never automatically overwritten.
- Derived indexes are rebuildable; hidden data is never the only copy of knowledge content.
- Do not preserve deprecated architecture through compatibility layers.

## 7. Current Vault Ingress Contract

Queue note:

```text
SelfGrow/Inbox Queue.md
```

Durable capture folder:

```text
SelfGrow/Inbox/
```

Completed knowledge root:

```text
SelfGrow/Knowledge/
```

Distilled Wiki root:

```text
Wiki/
```

Queue processing order:

```text
parse exact unchecked entries
→ validate one HTTP(S) URL
→ convert the local capture token to canonical imported_at using device timezone
→ materialize the Inbox note idempotently
→ mark the queue line checked
→ process eligible Inbox notes oldest first
```

## 8. Next Task

No numbered V5 implementation task remains. The next window should work in collaboration-focused stabilization mode. Begin from updated `main`, create one branch for one scoped issue, and prioritize Android compatibility or a currently reproducible desktop/mobile parity defect. The historical live-Vault defect below remains useful evidence but is no longer the default first task. P0 product-foundation work remains deferred until the user explicitly reopens it near the final product pass.

- Applying an approved `selfgrow-wiki` batch while Obsidian/SelfGrow was running failed twice with the guard script's generic rollback error. The first failure left one Raw at `processing` and two at `failed`; the second marked all three `failed`. Wiki pages, Index, Log, and promoted assets rolled back correctly.
- The identical validated proposal applied successfully to a normal workspace copy, and a repeated atomic-replace probe inside the live iCloud `Wiki/Assets` directory also passed. After the user cancelled/reselected the same three Raw cards and fully exited Obsidian, the real Vault apply succeeded.
- This was strong evidence of a live Obsidian/plugin watcher write race, not evidence that the proposal or iCloud atomic replacement was generally invalid. At the time, the guard hid the original exception, so the exact failing stage could not be proven.
- The required fix was to preserve the original exception and write stage, handle only the observed class of transient conflict, retain exact-hash eligibility, approval, rollback, protected `我的经验`, and retryability, then add one focused regression check and rerun the full gate.

Guard hardening completed on 2026-08-11:

- `atomic_write()` now retries only bounded transient access/busy/sharing/lock conflicts (`EACCES`, `EBUSY`, Windows errors 5/32/33) across 350 ms total; non-transient failures still abort immediately.
- Failed transactions now report the exact write stage, SelfGrow-relative path, exception type, and original safe message after rollback instead of the previous generic error.
- The focused self-test injects one transient replace conflict and proves eventual success, then injects a permanent Wiki-page failure and proves diagnostic preservation, page rollback, failed Raw status, and unchanged content hash.
- Skill self-test, compilation, official validation, and the complete plugin gate pass: 31 test files, 218 tests, and the unchanged 489,609-byte production bundle (114,294 bytes gzip).
- The project and personal Skill guard copies match SHA-256 `A384748D5257DC8DB7733ED7065BF04F8822D2744AB6E16DE8E8648553BA7246`; the installed copy's self-test passes.
- The original two live failures predated diagnostics, so the exact locked stage and whether the bounded retry fully closes the Obsidian-running case remain unproven. Confirm with the next explicitly approved selected-Raw batch while Obsidian is running; if it fails, retain the new stage/path/cause output and do not guess.

After live confirmation, continue only with user-observed UX/content-quality tuning. Use `selfgrow-wiki` only for user-selected Raw batches; run its maintenance inspection after Raw deletion and require approval before removing explicit broken `Knowledge/...` links.

iCloud folder/mobile-navigation stabilization completed on 2026-08-11:

- Live inspection confirmed six empty iCloud conflict directories—`Assets(1)`, `Concepts(1)`, `Experiences(1)`, `Methods(1)`, `Questions(1)`, and `Topics(1)`—all created within two seconds while the canonical folders already existed. Valid Wiki pages and the promoted asset remained only in the canonical folders.
- The root cause was secondary-device startup treating a not-yet-indexed synchronized folder as absent and recreating the fixed Wiki layout. `ObsidianVaultAdapter.exists()` now falls back to the official mobile-safe `DataAdapter.exists()` when the Vault cache misses a path, and an existing `Wiki/Index.md` is the schema-initialization marker so another device does not recreate type folders.
- Review discovery no longer depends on knowing the English command name: the command is bilingual, a native ribbon action opens Review, and SelfGrow Queue has a 44 px `知识筛选` / `Review knowledge` button using the same Review view.
- The six empty conflict directories were removed after exact containment and emptiness checks. No Wiki page or asset was deleted. Canonical Wiki files remain at `Wiki/Concepts/软件系统架构模式.md`, `Wiki/Methods/Agent 应用开发学习路径.md`, `Wiki/Methods/Coding Agent Skills 选型.md`, and `Wiki/Assets/六大系统设计架构.png`.
- The complete gate passes formatting, lint without warnings, source/test typechecking, 220 tests in 31 files, and production build. The bundle is 490,181 bytes raw and 114,389 bytes gzip. Source, desktop, and mobile `main.js` match SHA-256 `2B5F36A5F132FDDA278BB6C8CFD6CE286658321524FD06C9E005B0860AA63AEC`.
- One mobile user-observed checkpoint remains: fully close and reopen Obsidian after iCloud finishes syncing, verify the three Wiki pages appear inside Concepts/Methods, and open `知识筛选` from the Queue button or ribbon. Folder depth is not an Obsidian schema limit; if files still remain absent after a cold restart, investigate device-side iCloud hydration/indexing rather than flattening the validated Wiki layout.

Mobile Wiki write-ownership refinement completed on 2026-08-12:

- The six empty `(1)` conflicts reappeared together at 02:55 even though canonical Wiki files remained intact. This proved that cache-aware existence checks alone cannot cover the interval where iCloud has not hydrated or indexed `Wiki/Index.md` on iPhone.
- Mobile startup no longer creates any Wiki schema path. Desktop startup remains the single plugin-side owner of missing Wiki directories, Index, and Log; mobile continues to capture, review, select, and read synchronized Wiki content.
- A focused regression check proves mobile initialization performs no Wiki write. Formatting, lint, source/test typechecking, 221 tests in 31 files, and production build pass. The bundle is 490,225 bytes raw and 114,407 bytes gzip.
- The reappeared conflict directories were again verified empty and removed. The new build was installed to both desktop and mobile plugin directories. A full mobile app restart is required because Obsidian does not hot-reload an already-running plugin bundle.

Stale iCloud placeholder recovery completed on 2026-08-12:

- Obsidian desktop stalled at workspace loading while Windows Automatic File Download repeatedly requested the already mobile-deleted Raw `计算机科学的本质-数据库、向量、Transformer与LLM都是“表示”.md` at 0 bytes.
- Windows inspection proved the remaining desktop entry was an offline, sparse, recall-on-access iCloud placeholder rather than hydrated Markdown. Desktop `workspace.json` still selected it as the active Markdown file, and both desktop/mobile workspace histories retained the path, so every startup retriggered hydration.
- Obsidian was fully closed, the stale desktop and mobile workspace references were removed, and the offline placeholder was deleted from the Windows Vault to match the user's mobile deletion. Both workspace JSON files validate, the stale reference count is zero, and the other nine Knowledge files remain present.
- This was external iCloud/workspace state, not a SelfGrow capture or Wiki-schema defect; no plugin source or build artifact changed for this recovery.

Sibling Wiki migration completed on 2026-08-12 and category correction completed afterward:

- iPhone consistently displayed `Index.md` and `Log.md` at the old Wiki root but not pages inside type subfolders. The longest affected full path was only 96 characters, so the observed boundary was nested iCloud/Obsidian synchronization rather than Apple's 256-character path limit.
- The final Vault layout is `SelfGrow/` for capture/Raw material and a sibling `Wiki/` with fixed `Topics`, `Concepts`, `Methods`, `Experiences`, `Questions`, and `Assets` folders. Wiki type remains in `wiki_type` frontmatter and semantic structure remains in native wikilinks.
- Existing Index and Log were migrated to `AI/Wiki/`; the three Wiki pages returned to their matching type folders and the architecture image to `AI/Wiki/Assets/`. Raw targets and the architecture embed use those portable categorized paths.
- A direct move of the four iCloud ReparsePoint files was rolled back by File Provider. The final migration therefore copied each file to its category, verified matching SHA-256, and only then removed the exact root source; a delayed recheck confirmed the categorized layout remained stable.
- Mobile then showed the category folders but not their Markdown children. Obsidian ignore settings were empty and the nested files remained byte-readable on Windows, isolating stale iCloud File Provider object state rather than a schema or Obsidian exclusion. All six fixed folders were preserved. The three Markdown files were rewritten in place with one harmless trailing newline to create new cloud content versions, and the promoted PNG was rewritten byte-identically; a delayed recheck confirmed the same categorized tree. Mobile cold-start visibility remains the user-observed checkpoint.
- The decisive sync probe showed that neither a new root file nor a new nested file reached iPhone. Windows iCloudDrive logs exposed expired credentials (`kAOSErrorInvalidCredentials`, missing account DSID), followed after reauthentication by stale parent records and failed upload batches. The user reauthenticated iCloud; its processes were restarted. A verified external backup captured all categorized content before repair. The six fixed category directories were rebuilt with new valid cloud identities, the three Wiki pages and promoted image were restored byte-identically from the backup, and iPhone then displayed all three pages in Concepts/Methods. The obsolete `SelfGrow/Wiki` skeleton and all temporary probes were removed afterward. Final delayed validation found one sibling Wiki, six category directories, three pages, Index/Log, zero probes, and zero credential/missing-parent errors in the current iCloudDrive log. The external recovery backup remains temporarily at `.icloud-recovery/wiki-categories-20260813` until the user confirms mobile cleanup propagation.
- The old `AI/SelfGrow/Wiki` tree was removed only after every source file had been copied and every old directory was verified empty. No compatibility tree remains.
- Desktop `AI/SelfGrow` resolves portable categorized targets to sibling `AI/Wiki`; the iPhone `AI` Vault resolves them to `Wiki`. The project and personal `selfgrow-wiki` Skill enforce the same two-root containment and fixed type folders.
- After the category correction, formatting, lint, source/test typechecking, 221 tests in 31 files, production build, Skill self-test/compilation, and official Skill validation pass. The production bundle is 490,324 bytes raw and 114,456 bytes gzip.

Mobile progress on 2026-08-09: inspection confirmed that `AI/.obsidian` is the iPhone-specific Vault configuration directory (`workspace-mobile.json` is present) and its `plugins` directory was empty. The same validated `manifest.json`, `main.js`, and `styles.css` were therefore installed into `AI/.obsidian/plugins/selfgrow/` with matching SHA-256 hashes. iCloud delivery, mobile detection/enablement, device-local SecretStorage behavior, and the controlled mobile run remain.

Prompt-v2 refinement on 2026-08-09 established compact recognition cards for technology stacks, skills, algorithms, data structures, architectures, and professional terms. Prompt v3 retains that content contract, but production now ignores generated classification paths and commits directly to `Knowledge/<article title>.md`. Existing prompt provenance remains truthful until a note is regenerated.

Collection-UX refinement on 2026-08-09: the user requested that technical Inbox state not appear as normal Vault content and that desktop capture not require manual timestamp formatting. Managed captures now receive `cssclasses: selfgrow-internal`; scoped production CSS hides the `SelfGrow/Inbox` folder plus raw properties/inline titles, while the operational Inbox remains the supported UI. Queue reconciliation durably canonicalizes either a bare HTTP(S) URL or `- [ ] <URL>` to the standard device-local timestamped task before materialization and acknowledgement. Shortcut grammar remains compatible. Two new tests cover canonicalization, timestamping, materialization, acknowledgement, and internal-class persistence; both desktop/mobile plugin installations have matching updated artifacts.

Live follow-up showed that the initial hide selectors targeted `data-path` on the folder container, while Obsidian 1.13 places it on `.nav-folder-title`, and that `cssclasses` alone did not reliably scope Live Preview properties. The corrected build hides both the actual title node and its `:has()` folder container, and production lifecycle code now marks every open internal Markdown view with `selfgrow-internal-view` on active-leaf/layout changes. CSS hides properties and inline titles beneath that plugin-controlled container with `!important`. The corrected build passed the same complete gate and was installed to both desktop/mobile plugin directories.

Desktop validation completed on 2026-08-09: the user identified `C:\Users\baiyi\iCloudDrive\iCloud~md~obsidian\AI` as the intended repository folder, while Obsidian's own global registry reports the open Vault root as its parent `C:\Users\baiyi\iCloudDrive\iCloud~md~obsidian`. The validated artifacts are installed under that registered Vault's `.obsidian/plugins/selfgrow/`; the mistaken nested installation was verified to contain only the three copied artifacts and removed. Live validation proved queue acknowledgement, Inbox materialization, honest `incomplete_extraction / platform_adapter_required` for Xiaohongshu, queue-modification wakeup, generic-article extraction, the expected `waiting_ai_configuration` checkpoint, SecretStorage-backed DeepSeek `deepseek-v4-flash` connection testing, retry recovery, canonical note creation/opening, temporary-capture removal, and post-completion plugin reload persistence. The completed note remains readable at `Knowledge/地球科学/矿物/黑曜岩/黑曜岩-725e7b80e8fd.md`; the incomplete Xiaohongshu capture remains recoverable in Inbox.

Phase D remainder completed on 2026-08-09. Platform adapters now cover YouTube, Bilibili, Xiaohongshu, Douyin, and WeChat with captured-text priority, video title/description priority, the five-minute transcript ceiling, explicit provider disclosure, and honest recoverable outcomes. OpenAI-compatible embeddings are optional derived data; compatible vectors drive a reasoned similar-content warning after commit, default keep-both behavior, and explicit deletion of either note. The complete gate passes 31 files and 268 tests.

Task-040's V4 broad end-to-end target is superseded by Task-053. Cancelled V4 features are historical records, not later-stage commitments.

## 9. Validation State

At the last consistency check:

- the live iCloud Vault has no `AI/SelfGrow/Wiki`; `AI/Wiki` owns the five fixed type folders and Assets directly, with pages in Concepts/Methods and the promoted image in Assets
- the sibling categorized-Wiki implementation passes formatting, lint, source/test typechecking, all 221 tests in 31 files, production build, Skill compilation/self-test, and official Skill validation; source, desktop, and mobile `main.js` match SHA-256 `8DA267B6434AD559CAF1636C36601C9A32BB88EF1933258ABAD5FAE6ED6D64BB`
- the project and personal `selfgrow-wiki` Skill copies match: `SKILL.md` SHA-256 `8F92E6FA301CB8FBFF913157C6F519FF9ED4E452C7A3D99B397D4EBF7E66A3F5` and guard script SHA-256 `D65161D17A7BE775882C5C3386E2F3E2CB3377BCB6AC9455AA83D3BD72161FCE`
- the first real approved three-Raw batch created three linked Wiki pages, updated Index/Log, promoted the architecture image with a matching SHA-256, and marked all three Raw hashes/targets completed
- two live applies with Obsidian running failed and rolled back; the same proposal succeeded after Obsidian was fully exited, motivating the guard hardening recorded below
- the project-owned guard now has bounded transient-sharing retries and stage/path/cause diagnostics; deterministic success/failure injection, Skill validation, and the full 218-test plugin gate pass, while one Obsidian-running approved-batch confirmation remains
- the six empty iCloud `(1)` Wiki conflict directories were removed; cache-aware existence checks, Index-marker initialization, bilingual ribbon/command access, and a Queue Review button pass the full 220-test gate, while mobile cold-restart visibility remains a user-observed checkpoint
- temporary proposals and diagnostic copies were removed after validation
- all Markdown code fences were balanced
- Task IDs 001 through 053 are present with no gaps; cancelled and superseded tasks remain explicitly labeled as history
- the mandatory Chinese engineering-rule block appeared in both required locations
- all six source-of-truth documents report Version 5.0 and have balanced Markdown fences
- the recommended new-window prompt points only to the active V5 roadmap
- Task-045 was documentation-only; no source, test, build, or installed-plugin validation result was changed
- the obsolete `obsidian://new` collection route had no remaining active references
- all six source-of-truth documents agreed that title/description-only extraction is incomplete
- Task-004 added no plugin source and installed no package
- selected runtime boundaries contain no Node/Electron dependency
- Task-005 `npm run check` passed all scaffold validations
- Task-005 production bundle was 602 bytes raw and 408 bytes gzip
- Task-005 bundle metadata contained only `src/main.ts` plus the external `obsidian` import
- Task-006 `npm run check` passed all 12 tests plus formatting, lint, source/test typechecking, and production build
- Task-006 production bundle remained 602 bytes raw and 408 bytes gzip
- Task-006 test HTTP transport rejects unknown requests and redacts Authorization/Cookie headers in recorded calls
- Task-006 filesystem loading and all obviously fake secret values are confined to `tests/`
- Task-007 exhaustive transition tests cover all 100 source/destination state pairs
- Task-007 uses branded IDs/paths and contains no `any` type bypass
- Task-008 strict jitless Zod settings validation rejects unknown and secret-value fields
- Task-008 Chat/Embeddings invalidation and owned/shared secret clearing rules are independently tested
- Phase B final `npm run check` passed all 41 tests plus formatting, lint, source/test typechecking, and production build
- Phase B final production bundle remained 602 bytes raw and 408 bytes gzip because foundation modules are not yet composed into lifecycle behavior
- At the Phase B checkpoint, Zod 4.4.3 was the only production dependency and the installation audit reported zero known vulnerabilities across 376 packages
- Task-009 passed 65 tests covering path containment, URL identity, platform classification, short links, and unsafe targets
- Task-010 passed 74 tests including Chinese/English round trips, fenced headings, conflicts, and personal-Markdown preservation
- Task-011 passed 80 tests covering queue atomicity, restart idempotency, timezone conversion, malformed isolation, and re-import routing
- Task-012 passed 85 tests covering scoped rebuild, incremental events, atomic duplicate rejection, and body-preserving re-import
- Task-013 passed 90 tests covering multiple roots, folder/note moves, cycle/collision prevention, and exact impact counts
- Phase C uses Obsidian Vault, FileManager, MetadataCache, frontmatter, normalizePath, and browser Web Crypto boundaries without Node/Electron mobile imports
- Zod 4.4.3 and mdast-util-from-markdown 2.0.3 are the only direct production dependencies; the latest installation audit reported zero known vulnerabilities across 408 packages
- Phase C final production bundle remained 602 bytes raw and 408 bytes gzip because services are not yet composed into plugin lifecycle behavior
- no Node/Electron mobile-runtime import or stale standalone-app artifact exists
- Task-014 production transport uses Obsidian `requestUrl`, validates request limits and Phase C URL safety before dispatch, races timeouts, bounds `arrayBuffer` bytes before text access, and checks visible redirects
- Task-014 fixture parity preserves exact no-network routing and redacted ordered calls while adding real UTF-8 response bounds and shared safety validation
- Task-014 `npm run check` passed formatting, lint without warnings, 104 tests, source/test typechecking, and production build
- Task-014 production bundle remained 602 bytes raw and 408 bytes gzip because the transport is not yet composed into plugin lifecycle behavior
- Task-014 added no dependency and contains no browser fetch, Axios, Node, or Electron mobile-runtime import
- Task-015 Chat probes validate configuration, authentication, model, protocol, response shape, per-request secret lookup, and localized safe failures
- Task-016 Embeddings probes validate vector count/index/dimensions/finiteness and deterministic fingerprints independently from Chat
- Task-017 strict generation parsing and adversarial prompt fixtures enforce bounded source-grounded Chinese/English output and one portable theme path
- Task-018 captured-text/generic extraction fixtures cover HTTP fallback, canonical URLs, retained structural Markdown, malicious markup removal, complexity/body limits, and honest incomplete outcomes
- Task-025 theme fixtures cover normalized reuse, missing-folder creation, exactly-once initial move, invalid paths, and regeneration immutability
- Task-024 coordinator fixtures cover oldest-first concurrency one, checkpoint order, reload reconstruction, recoverable waiting states, terminal cleanup, safe failure records, commit-before-cleanup, and canonical Markdown output
- Phase D core final `npm run check` passed formatting, lint without warnings, all 225 tests in 20 files, source/test typechecking, and production build
- Phase D core direct dependency versions are pinned; the installation audit reported zero known vulnerabilities across 448 packages
- Phase D core production bundle remained 602 bytes raw and 408 bytes gzip because lifecycle composition belongs to Minimum product entry
- Task-039 tests cover extraction disclosure, required representative capabilities, health-only rejection, stale-test invalidation, and secret-reference-only persistence
- Task-032 tests cover every state label, retry eligibility/attempt reset, commit-before-capture-removal, post-removal note opening, terminal body cleanup, and Inbox-only permanent deletion containment
- the queue location `SelfGrow/Inbox Queue.md` is materialized and acknowledged idempotently by fixtures while excluded from capture adoption; the nested queue path remains compatibility-only
- Minimum product entry composes only after `workspace.onLayoutReady`, responds to new Inbox files, drains one foreground capture at a time, and opens completed Markdown through the Obsidian workspace
- Minimum product entry plus iCloud parent-Vault root detection, oversized short-link fallback, and current-frontmatter state validation `npm run check` passed formatting, lint without warnings, all 249 tests in 26 files, source/test typechecking, and production build
- prompt v3 recognition-card bounds, desktop bare-URL canonicalization, and internal presentation are covered by the generation and Inbox suites
- production `main.js` is 504,273 bytes raw and 118,461 bytes gzip under the 750 KiB product-entry budget; build metadata shows Obsidian as the only external runtime package and rejects Node/Electron imports
- no writable worker mailbox or temporary Luna boundary remains in the project
- Phase D remainder final `npm run check` passes formatting, lint without warnings, all 268 tests in 31 files, source/test typechecking, and production build
- video fixtures enforce title/description priority, subtitle fallback only at a confirmed duration of at most 300 seconds, and honest over-limit/unknown-duration outcomes with the source link retained
- runtime embeddings are optional derived plugin data; strict response validation, source hashes, model-fingerprint/dimension compatibility, similarity reasons, default keep-both, and explicit delete-either behavior are fixture-tested
- the Phase D remainder production bundle is 522,533 bytes raw and 123,121 bytes gzip
- `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes
- Inbox progress presentation now refreshes on every durable processing checkpoint and renders a staged circular indicator: queued 8%, extracting 28%, generating 55%, embedding 75%, classifying 90%, green completed 100%, and red failed/incomplete 100%. Successful rows remain briefly visible after capture cleanup; failures show a safe reason mapped from `last_error_code` rather than a generic message.
- The progress-UI refinement passes all 269 tests in 31 files; the production bundle is 526,149 bytes raw and 124,182 bytes gzip. Desktop/mobile plugin artifacts again have matching SHA-256 hashes.
- Live failure inspection found Xiaohongshu returning no anonymously readable body/description (`provider_not_configured`) and a WeChat Official Account page exceeding the generic 2 MB response bound (`OBSIDIAN_API_FAILED`, `response_too_large`). WeChat now has a separate bounded 5 MB HTML allowance while retaining document-complexity checks. Failed Inbox rows map safe error codes to specific user-facing explanations. The complete gate still passes 269 tests; the bundle is 527,121 bytes raw and 124,468 bytes gzip, installed identically on desktop/mobile.
- Live Douyin inspection resolved the supplied short link to `iesdouyin.com/share/note/...`, where anonymous access returned a WAF challenge; the legacy public detail endpoint returned `encrypt_data_miss` and the current web endpoint was blocked. The adapter now still accepts public `og:title` plus a meaningful `og:description` when exposed, detects WAF pages explicitly, preserves the direct failure reason when no optional provider is configured, and tells the user to open the source without bypassing verification or using account Cookies. The complete gate passes 270 tests; the bundle is 528,746 bytes raw and 125,006 bytes gzip, installed identically on desktop/mobile.
- Queue capture-window refinement: opening `Inbox Queue.md` now switches the leaf to the SelfGrow Queue window. Its form requires a link and accepts optional notes plus up to three bounded images. The pipeline tries the link first, combines successful link content with notes/AI-recognized image text, or uses notes/OCR as the fallback. User material is retained in `我的笔记`; original link remains in `来源`. Images stay under contained `Inbox/Attachments` only while retryable and are deleted on completion/permanent deletion. Legacy Shortcut queue lines remain compatible. The validation gate passes 274 tests in 33 files; the production bundle is 540,866 bytes raw and 128,413 bytes gzip. Desktop/mobile artifacts have matching SHA-256 hashes.
- Flat-Knowledge refinement: production no longer creates or resolves AI classification folders. New cards are committed as `Knowledge/<sanitized article title>.md` with no ID/hash suffix; title collisions fail safely. Four existing cards were moved to the Knowledge root and all empty generated classification folders were removed. The complete gate passes 274 tests in 33 files; the production bundle is 476,517 bytes raw and 109,553 bytes gzip. Source, desktop, and mobile plugin artifacts have matching SHA-256 hashes.
- Flat-index startup fix on 2026-08-10: Inbox submission had remained unavailable after reload because `URLNoteIndex` still rejected cards stored directly under `Knowledge`, causing workspace initialization to stop before the manual capture submitter was installed. Root-level Markdown cards are now indexed, nested legacy files are ignored during rebuild instead of blocking startup, and runtime note operations retain the flat-path constraint. The complete gate passes 274 tests in 33 files; the production bundle is 476,648 bytes raw and 109,599 bytes gzip.
- Direct-material routing refinement on 2026-08-10 (routing rule later superseded by the next refinement): a link-only capture uses extraction and AI summarization, while short direct material creates a plain Markdown document under Knowledge containing untouched text, original embedded images, and the optional source link. The optional user title is preferred; otherwise the filename/title is derived locally from the first text line, first image filename, or link hostname. Original direct-route images are retained under the non-classification `SelfGrow/Attachments` folder, which is hidden from normal file navigation. That checkpoint passed 278 tests in 34 files; its production bundle was 479,182 bytes raw and 110,371 bytes gzip.
- Queue-input and responsiveness refinement on 2026-08-10 (text-length routing later superseded by the next refinement): the optional share/link field extracts the first valid HTTP(S) URL from a complete platform share message and preserves surrounding copy; a link is not required. Save and Retry return after durable local state while foreground work continues asynchronously. The Queue UI uses a responsive native-theme capture card with inline routing feedback. Successful Inbox captures are removed without a transient success row; stale completed captures are purged only after confirming their indexed Knowledge note. That checkpoint passed 285 tests in 35 files; its production bundle was 482,414 bytes raw and 111,436 bytes gzip.
- Content-density refinement on 2026-08-10: any supplied text now uses AI regardless of length, and a pure link still uses extraction plus AI; only image-only/image-plus-link input without text remains direct. Prompt v5 silently selects one of eight templates—technical tutorial, viewpoint/argument, experience sharing, method/framework, tool/product, case review, concept explanation, or update/news—then produces one paragraph of one to three information-dense sentences. It removes generic framing, greetings, promotion, repetition, and background filler, and retains exactly one non-repeating actionable step, decisive mechanism, or boundary. The strict summary bound is 280 characters and the core explanation bound is 140 characters. The Queue hint now states that text and pure links use AI. The complete gate passes 287 tests in 35 files; the production bundle is 484,149 bytes raw and 112,072 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes.
- Inbox submission failure fix on 2026-08-10: live inspection showed no new Inbox file, locating the generic failure before durable capture rather than in prompt v5. Allowlisted platform short-link resolution could time out before save. The URL service now retains the already safety-checked original short URL on offline/timeout/Obsidian transport failures while still rejecting unsafe redirects. Inbox submission maps invalid, unsafe, duplicate, network, and Vault-write failures to specific localized safe messages. A view-refresh failure can no longer make a committed capture report failure. The complete gate passes 288 tests in 35 files; the production bundle is 485,461 bytes raw and 112,369 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes.
- Duplicate-index initialization fix on 2026-08-10: frontmatter-only live Vault inspection found two Knowledge files carrying the same `selfgrow_id` and `normalized_url`, which made `URLNoteIndex.rebuild()` throw before Inbox composition. Rebuild now sorts candidate paths deterministically, indexes the first non-conflicting identity, and preserves every Markdown file unchanged. Runtime create/move/index operations still reject new duplicates before mutation. The complete gate passes 289 tests in 35 files; the production bundle is 485,663 bytes raw and 112,438 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes.
- Personal-note ownership refinement on 2026-08-10: the Queue composer now has one link/share-message/text field and no separate “正文或补充笔记” field. A link is extracted from full share copy; when present, its extracted source body takes precedence, while URL-stripped share text and OCR are temporary fallback context only. Captured bodies, share-copy residue, and OCR are never written into `我的笔记` / `My Notes`; new AI-generated cards initialize that user-owned section empty. The complete gate passes 290 tests in 35 files; the production bundle is 485,150 bytes raw and 112,256 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes.
- Deleted-card regeneration fix on 2026-08-10: live inspection confirmed the failed Xiaohongshu capture's normalized URL had no matching Markdown left under Knowledge, so `DUPLICATE_URL` came from an in-memory URL identity whose file had been deleted after startup. URL lookup now verifies the indexed Vault path, atomically evicts missing URL/ID/path mappings, and returns no duplicate. Final index insertion repeats stale-conflict pruning to close deletion races. Existing failed captures can be retried and regenerated without restarting. The complete gate passes 292 tests in 35 files; the production bundle is 485,478 bytes raw and 112,326 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and mobile plugin directories with matching SHA-256 hashes.
- V5 product-design freeze on 2026-08-10: a 27-decision grilling session replaced the unfinished V4 roadmap with explicit Raw selection, renewed approval after edits, a user-invoked Codex proposal/confirmation loop, a minimal protected-section Wiki schema, native Markdown wikilinks, Raw-safe deletion, retained/promoted image ownership, and a manual post-distillation cleanup list. Custom Map, Today, Favorites, custom search/embeddings, AI folders, similar warnings, regeneration, export/PDF, Clear All, and custom graph infrastructure are cancelled. Task-045 changed documentation only; source, tests, build artifacts, and installed plugins were not modified.
- Task-046 Raw schema and selection state completed on 2026-08-10. `RawCardService` migrates existing completed Knowledge cards to unselected schema v2, hashes only user-visible Markdown content, derives queue eligibility from exact approved/current hash equality, invalidates approval after edits, supports cancellation and renewed confirmation, and constrains Raw/Wiki paths. New AI and direct-material cards write schema v2 immediately. The complete gate passes 297 tests in 36 files; the production bundle is 491,604 bytes raw and 113,789 bytes gzip. `main.js`, `manifest.json`, and `styles.css` were installed to both desktop and iPhone/iCloud plugin directories; both installed `main.js` files match source SHA-256 `A52AB6BB27C13464FD409CFE1F0631EF5A97E0FAABCD6F762D95EDF43EDF4209`.
- Task-047 persistent Raw images and visual preview completed on 2026-08-10. Every image on a successful AI route now moves from Inbox staging to `SelfGrow/Attachments`, is embedded in the Raw card, and participates in its content hash. Image-only capture runs direct multimodal visual understanding once, validates a concise title and single-sentence preview, and does not use OCR as a substitute. The complete gate passes 302 tests in 36 files; the production bundle is 495,104 bytes raw and 114,841 bytes gzip. Desktop and iPhone/iCloud installations match source `main.js` SHA-256 `142F9044630B088402B9ADCAB83C29D898153E4473995DE4E855FA567C27EF78`.
- Task-047 no-vision fallback refined on 2026-08-10 after live DeepSeek returned `AI_CONNECTION_TEST_FAILED` for an image-only capture. Visual capability is now optional: failure produces an honest Raw placeholder with the retained original and a Codex-after-selection boundary instead of leaving the item failed. New captures preserve an explicit or original-image-derived title; the existing failed capture can recover by retry without re-upload. The complete gate passes 303 tests in 36 files; the production bundle is 495,886 bytes raw and 115,061 bytes gzip. Desktop and iPhone/iCloud installations match source `main.js` SHA-256 `2B73458152EE4F3A443BE49ADD2F0B49B7630873891E9AD350C6BA90ACDB0B2C`.
- Task-048 SelfGrow Review completed on 2026-08-11. The new `Open knowledge review` command opens a native ItemView with five Raw sections, preview/source/time/image/status/target presentation, single and batch selection/cancellation/deletion, renewed update confirmation, and explicit Codex handoff copy. Raw deletion confirms intent, updates URL/derived indexes, removes only unreferenced Raw attachments, and never touches Wiki content. The complete gate passes 305 tests in 36 files; the production bundle is 507,655 bytes raw and 118,031 bytes gzip. Desktop and iPhone/iCloud installations match source `main.js` SHA-256 `E9EF472E056420E02B421AFF69C92488E21CDB639D7007E27F82D594ED7C51FF`.
- Task-049 Wiki schema and protected sections completed on 2026-08-11. Plugin startup now creates only missing `Wiki/Index.md`, `Wiki/Log.md`, the five fixed page-type folders, and `Wiki/Assets` inside the configured SelfGrow root. The shared Wiki serializer emits the stable four-section contract, permits only native wikilinks for semantic relations, and requires user-grounded evidence for experience content. AI-section updates reject ambiguous structure and preserve the complete existing `我的经验` suffix byte-for-byte. The complete gate passes 310 tests in 37 files; the production bundle is 508,197 bytes raw and 118,290 bytes gzip. Desktop and iPhone/iCloud installations match source `main.js` SHA-256 `654269EC34A5A7EDA5B91F77D31922FAAA2E368E4BC37B968751F6BE42A4234D`.
- Task-050 `selfgrow-wiki` Codex skill completed on 2026-08-11. The Skill discovers only exact-hash eligible Raw cards, exposes retained images/current Wiki for inspection, requires a validated visible proposal and explicit approval, and delegates contained writes to a standard-library guard script with rollback. Existing `我的经验` bytes are preserved, external-only experience and Markdown-link relations are rejected, promoted assets remain independent, Index/Log and Raw completion metadata update together, and handled failures remain retryable. Portable `Wiki/...` targets resolve against each device's configured SelfGrow root. A real read-only Vault scan found three eligible cards and the retained pure-image asset. The plugin gate passes 311 tests in 37 files; Skill compile/self-test/validation pass; the production bundle is 508,361 bytes raw and 118,353 bytes gzip. Desktop and iPhone/iCloud installations match source `main.js` SHA-256 `BE551B0E7CFFB11D56EB5661234A9961957CFB4246035980253CDB821C2E9BEB`; the personal Skill matches project source hashes.
- Task-051 Wiki maintenance completed on 2026-08-11. The Skill now reports broken explicit Raw links and lint candidates without writing, requires separate approval for cleanup, removes only missing `Knowledge/...` links outside `我的经验`, and treats recollection as a new Raw decision. Its isolated fixture covers protected bytes, valid Raw/Wiki links, promoted assets, and recollection. The real Wiki scan returned zero current cleanup findings.
- Task-052 superseded-runtime cleanup completed on 2026-08-11. Vector settings/connection/generation/index/similarity UI, Topic Folder/theme classification, their stages/models/tests, and unused favorite/candidate/export/Clear-All contracts were deleted. The active pipeline is `extracting -> generating -> completed`; startup immediately rewrites stored data to the current settings-only schema, so old derived records do not remain active or persisted after reload.
- Task-053 end-to-end validation completed on 2026-08-11. User-observed desktop/iPhone checkpoints cover link, shared-text, and pure-image Raw capture, review/update confirmation, approved linked Wiki creation, and native graph display. Automated gates cover pre-approval immutability, exact-hash approval, protected experience, Raw-safe deletion, promoted assets, and maintenance approval. Formatting, lint, source/test typechecking, 218 tests in 31 files, production build, Skill compilation/self-test, and official validation pass. The final bundle is 489,609 bytes raw and 114,294 bytes gzip; source, desktop, and iPhone installations match SHA-256 `3DAF0D9C0628D9984F86F835964A5F0566A5D42C687EAD3E50C53C37885EC5F4`.
- Raw folder creation refinement on 2026-08-13: the collection view now places an explicit `新建文件夹` / `Create folder` button beside the Raw folder field. It creates a valid first-level folder immediately (or selects the existing folder), keeps it selected for the capture, and reports invalid names locally; save-time folder creation remains compatible. The complete gate passes 205 tests in 29 files; the production bundle is 489,032 bytes raw and 114,228 bytes gzip.
- Raw review folder filter refinement on 2026-08-13: the knowledge-review view now offers a native `全部文件夹` / `All folders` selector populated from the same first-level Raw folders as collection. Switching folders filters the displayed cards without moving or mutating them and clears transient batch checkboxes to prevent hidden-card actions. The complete gate passes 205 tests in 29 files; the production bundle is 489,829 bytes raw and 114,460 bytes gzip.
- Shared-link residue fix on 2026-08-15: once the link/share field yields a valid HTTP(S) URL, all surrounding platform share copy is discarded instead of entering Raw titles, previews, captured text, or AI context; only the separately entered body is retained. Linkless text capture remains unchanged. The gate passes formatting and lint, all 206 tests in 29 files, source/test typechecking, and production build; the bundle is 489,631 bytes raw and 114,385 bytes gzip.
- Douyin extracted-title root fix on 2026-08-15: live post-install inspection proved the active plugin hashes were current but Douyin's own public `og:title` repeated the `复制打开抖音` share command. The Douyin adapter now ignores that metadata title entirely and creates Raw body/title/preview from the meaningful public description only. The complete gate passes 206 tests in 29 files; the production bundle is 489,508 bytes raw and 114,316 bytes gzip.
- Minimal UI implementation on 2026-08-15: the approved mobile-first preview is now applied to Collect and Review with native underline navigation, a compact icon-only folder action, border-first forms/cards, two-line Raw previews, hidden empty groups/batch controls, and accessible native overflow menus for Open/Delete. The reusable `selfgrow-minimal-ui` Skill records the Obsidian-native, single-accent, no-framework design and validation rules and passes official Skill validation. The complete plugin gate passes 206 tests in 29 files; the production bundle is 488,812 bytes raw and 114,111 bytes gzip.
- Review interaction refinement on 2026-08-15: default Raw cards no longer reserve space for checkboxes or repeat a full-width selection button. `多选` now explicitly enters selection mode, reveals 44 px checkbox targets, highlights checked cards, and exposes batch select/cancel/delete only after at least one card is checked; completing a batch action exits the mode. The changed-Raw `确认更新` action remains visible, while Open/Delete stay in overflow. Review and Collect buttons now have short native-theme press transitions, visible keyboard focus, reduced-motion support, and asynchronous busy feedback where actions await work. The complete gate passes 210 tests in 29 files; the production bundle is 494,438 bytes raw and 116,775 bytes gzip.
- Raw card swipe refinement on 2026-08-15: outside the independent `多选` mode, a deliberate 80 px right swipe selects an unselected Raw card for distillation and a left swipe opens its existing confirmed-delete flow. Horizontal intent is separated from vertical scrolling, short gestures snap back, interactive card controls do not start swipes, and selection mode disables card gestures. The complete gate passes 210 tests in 29 files; the production bundle is 496,173 bytes raw and 117,300 bytes gzip.
- Obsidian mobile swipe-conflict fix on 2026-08-15: Raw cards now contain both Pointer and iOS Touch event propagation for gestures that begin inside a card, and horizontally contain WebView overscroll. This prevents the same left/right movement from opening Obsidian's directory or current-file-links sidebars while preserving native vertical scrolling and the card's 80 px action threshold. The complete gate passes 210 tests in 29 files; the production bundle is 496,455 bytes raw and 117,383 bytes gzip.
- Raw title/preview refinement on 2026-08-15: repeated platform descriptions now become concise topic titles after removing generic Chinese framing, and a matching opening sentence is omitted from the two-sentence, 140-character selection preview. The complete extracted source remains unchanged under original material. The complete gate passes 207 tests in 29 files; the production bundle is 489,464 bytes raw and 114,630 bytes gzip.
- Future-input title/preview generalization on 2026-08-15: the shared Raw generator now handles multiple Chinese platform framing variants such as `这篇图文` and `这条图文向大家推荐了`, prefers an explicitly named `《…》` subject, reduces other titles to the first meaningful clause, and compares normalized text before removing a repeated opening sentence from the preview. Numbered steps no longer count as sentence endings. The complete gate passes 208 tests in 29 files; the production bundle is 489,920 bytes raw and 114,951 bytes gzip.
- AI recognition-card refinement on 2026-08-15: every future non-visual queued Raw capture now makes one bounded call to the configured Chat endpoint for only a short noun-phrase title and one non-repeating selection reason, while the complete extracted material remains unchanged. Strict schema, length, single-sentence, and title-prefix checks reject verbose or repetitive output; missing configuration, provider failure, or invalid output falls back to deterministic local generation without blocking capture. Existing visual-only recognition remains single-pass. The complete gate passes 210 tests in 29 files; the production bundle is 493,689 bytes raw and 116,583 bytes gzip.
- Review interaction refinement on 2026-08-16: the 知识筛选 card gestures now follow the user's mobile-first model. A tap on a card opens its Raw note; a 500 ms long-press enters multi-select and selects that card, replacing the removed `多选` button, and the batch bar adds `完成` to exit multi-select. Outside multi-select, swiping right toggles the deposit decision — selects an unselected card and deselects a queued/selected one — while distilled cards never swipe right (no hint label and rightward drag is clamped); swiping left still opens the confirmed-delete flow. The card's overflow menu now offers `选择沉淀`/`取消沉淀` and `删除` for desktop use, replacing the previous Open/Delete pair. Cards disable text selection and show a pointer cursor, and multi-select taps toggle the checked card. design-system.md and product-spec.md now describe the new interaction contract. The complete gate passes formatting, lint without warnings, all 210 tests in 29 files, source/test typechecking, and production build; the bundle is 497,201 bytes raw and 117,598 bytes gzip. The new `main.js` (SHA-256 `4AFDD0F6EA2AA95B3A6672AEB9E901DBDE29A5CE0B3B069222D4C22C4C59208D`) was installed with `manifest.json` and `styles.css` to both the desktop Vault-root and the iPhone `AI` plugin directories, and a full Obsidian restart is required to load it.
- Review gesture-tuning follow-up on 2026-08-16: after the user's first real-run feedback, opening a Raw note now requires a double tap — a single tap only plays press feedback, so swipes and opens no longer mis-trigger. The `选择沉淀`, `取消沉淀`, and `删除` batch actions appear only while at least one checkbox is checked (the `已勾选 n 条` count and `完成` remain visible during multi-select). Card motion is livelier: fast press scale-in with a springy release, spring snap-back after incomplete swipes, sliding swipe-reveal labels, popping checkboxes on multi-select entry, and an easing batch bar, all disabled under `prefers-reduced-motion`. design-system.md and product-spec.md reflect the double-tap contract. The complete gate passes formatting, lint without warnings, all 210 tests in 29 files, source/test typechecking, and production build; the bundle is 497,404 bytes raw and 117,666 bytes gzip. The refined `main.js` (SHA-256 `754A98EBA28E8B17EAC921E9881905E5B32B0B6329C27D2DAE7F527318FA57AF`) and `styles.css` were installed with matching hashes to both plugin directories; a full Obsidian restart loads them.
- Task-054 Raw categories, Markdown preservation, and GitHub sources completed on 2026-08-16. Raw now has three fixed categories — `Raw/Project` (runnable/reusable projects and GitHub repos), `Raw/Skill` (Agent Skills, capability packs, prompt tools), `Raw/Experience` (methods, tutorials, cases, learning paths) — created idempotently at startup; the Collect view uses a fixed three-way selector with no free-form folder and no `Knowledge` default. The AI recognition card now classifies category, writes a noun-phrase title and one 40–120-character selection-reason sentence, and may list GitHub search terms; output is strict JSON validated (category enum, cliché-free titles, single-sentence non-repeating preview) with at most one constrained repair and a deterministic local fallback recorded as `recognition_source: local` and labeled in the UI. `原始材料` preserves structured Markdown: source headings are demoted H1→H4/H2→H5 via the existing mdast AST (code fences, tables, nested lists, blockquotes, links and images untouched; never a giant blockquote). GitHub repository URLs route to a new extractor that resolves owner/repo and default branch, selects a language-matched README (explicit `README.zh-CN.md`-style names → same-repository language-switch links → default README, bounded within the repo), rewrites relative links/images to absolute GitHub URLs, and records README path/language in frontmatter. Bare repository/Skill names are completed through the GitHub Search API: single high-confidence exact matches auto-adopt, up to three candidates open a native 44 px confirmation list (owner/repo, description, stars, update time, archived badge), no reliable result keeps the original input with a `未找到可靠 GitHub 仓库` notice, and `Experience` input is never force-searched. A read-only `Scan raw folders` command reports before-count, per-category suggestions, unknown and conflict counts; migration stays an uninvoked, destination-conflict-safe, rollback-capable capability that preserves frontmatter, selection state, hashes, Wiki targets and attachments. No existing Raw file, user note, attachment, or Wiki content was modified or moved. The complete gate passes formatting, lint without warnings, all 250 tests in 34 files, source/test typechecking, and production build; the bundle is 572,428 bytes raw and 140,707 bytes gzip. Source, desktop, and mobile `main.js` match SHA-256 `3FF4FCFFE2D4E8AA098CF6A1BF493DC48676EB85F59CC09A8A967B40D42F8A84` after installation to both plugin directories. Real-device verification remains for iPhone GitHub candidate selection, multi-language READMEs, AI-fallback hints, and iCloud plugin reload.
- GitHub README fetch and rendered-image fix on 2026-08-17: repository extraction reads raw Markdown through the GitHub Contents API first, then falls back to `raw.githubusercontent.com`; every GitHub API/raw request carries `User-Agent: SelfGrow/0.1`, root-file discovery avoids probing missing language candidates, and UTF-8 base64 decoding preserves the selected README. Relative Markdown images resolve to raw URLs, while relative HTML `<img>` sources no longer duplicate the branch as `main/main`, so GitHub README text and image markup render normally in Obsidian. The real failed capture `ZzzLc0405/photo-abstract-editorial` has a valid `main/README.md`; the prior failure was API rejection plus malformed HTML image URLs, not missing source content. The complete gate passes formatting, lint without warnings, all 258 tests in 34 files, source/test typechecking, and production build; the 520,398-byte `main.js` (SHA-256 `4002836FC138913F88AB6F8E67162A88D4C41B0C05952E3F8C83A3EC5DC1B2B5`) is installed identically to both desktop and iPhone/iCloud plugin directories.
