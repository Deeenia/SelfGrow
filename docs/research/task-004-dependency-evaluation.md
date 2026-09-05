# Task-004 Dependency Evaluation

Date: 2026-08-09  
Status: Completed evaluation; no packages installed and no plugin scaffold created  
Scope: Obsidian 1.13.2 API surface, mobile runtime dependencies, and development-only test dependencies

## 1. Decision Summary

SelfGrow will prefer the Obsidian API and the iOS WebView platform before adding a package.

Selected production dependencies for the first implementation tasks:

| Need | Selection | Version evaluated | License | Runtime decision |
|---|---|---:|---|---|
| Runtime schema validation | `zod` | 4.4.3 | MIT | Select; import through one configured module with `z.config({ jitless: true })` before schemas are created |
| HTML article extraction | `@mozilla/readability` | 0.6.0 | Apache-2.0 | Select; pair with bounded `requestUrl`, native `DOMParser`, Obsidian sanitization, and completeness checks |
| Markdown section parsing | `mdast-util-from-markdown` | 2.0.3 | MIT | Select; use source positions to splice the original Markdown rather than serialize the whole note |
| Keyword indexing | `minisearch` | 7.2.0 | MIT | Select; use a deterministic Chinese/English tokenizer and incremental add/remove |
| PDF generation | `jspdf` | 4.2.1 | MIT | Select only as the Task-037 spike candidate; do not add it before that task and do not approve mobile support until iPhone validation |
| Tests and deterministic HTTP fixtures | `vitest` + `jsdom` + an in-project fixture transport | 4.1.10 + 30.0.1 | MIT + MIT | Select as development-only; never bundle into `main.js` |

Existing capabilities selected instead of dependencies:

| Need | Existing capability | Reason |
|---|---|---|
| Cross-origin HTTP | Obsidian `requestUrl` | Public mobile-capable API; avoids Axios and browser CORS limitations |
| DOM parsing | WebView `DOMParser` | Already present in desktop and mobile browser runtimes; avoids a second DOM implementation |
| HTML sanitization | Obsidian `sanitizeHTMLToDom` | Public API in current types; avoids bundling DOMPurify while keeping untrusted HTML out of live DOM |
| HTML to Markdown | Obsidian `htmlToMarkdown` | Public API preserves the native Obsidian conversion path; avoids Turndown |
| Frontmatter reads/writes | metadata cache, `getFrontMatterInfo`, and `FileManager.processFrontMatter` | Native semantics and safe writes; parsed values still require Zod validation |
| Atomic text transformation | `Vault.process()` | Re-runs the transformation against the current file contents and prevents stale read/modify/write overwrites |
| Binary PDF write | `Vault.createBinary` / `Vault.modifyBinary` | Mobile-safe Vault API; no raw filesystem access |

No dependency is installed in Task-004. Exact esbuild contribution must be measured in Task-005 or the first task that imports each package. npm unpacked sizes below are package-distribution footprints, not final bundled bytes.

## 2. Evaluation Criteria

Each candidate was checked against:

- current package/API version and primary documentation
- license
- recent release or repository activity
- browser and Obsidian-mobile compatibility
- Node.js or Electron assumptions
- package-distribution and expected bundle impact
- TypeScript support
- deterministic testability
- overlap with Obsidian or an already selected package
- one concrete selection or rejection reason

Mobile-runtime packages must not import Node built-ins. Development-only tools may require Node because they run on Windows CI/development, but they must be excluded from `main.js`.

## 3. Obsidian API Evaluation

The current published `obsidian` types evaluated are 1.13.2, MIT licensed, and maintained by Obsidian. The following public APIs cover SelfGrow needs without runtime bundle cost because `obsidian` remains external to the plugin bundle:

- `requestUrl` for HTTP(S) requests without browser CORS restrictions
- `Vault`, `FileManager`, `Vault.process()`, `createBinary`, and `modifyBinary`
- `normalizePath`, metadata cache, `getFrontMatterInfo`, and `processFrontMatter`
- `sanitizeHTMLToDom(html)` for sanitized fragments
- `htmlToMarkdown(html | HTMLElement | Document | DocumentFragment)`
- `SecretStorage` and `SecretComponent`

`requestUrl` does not expose a timeout or streaming response limit in its current public request parameters. SelfGrow must therefore race cancellation at the service boundary, reject oversized responses before DOM work where the returned representation permits it, and never treat the API itself as an SSRF policy. Redirect/final-host and URL-safety checks remain SelfGrow responsibilities.

`MetadataCache` heading positions are useful for reading and navigation but are not selected as the sole destructive-rewrite parser: cached offsets may lag the exact string supplied to `Vault.process()`. Section replacement must parse the current callback string.

## 4. Runtime Schema Validation

### Selected: Zod 4.4.3

- Official package: `zod`
- License: MIT
- Maintenance: latest evaluated release 4.4.3 was published 2026-05-04; active repository and release line
- Compatibility: zero runtime dependencies; ESM/CJS exports; documented for modern browsers and TypeScript
- Node assumptions: none in browser runtime
- Size: npm unpacked distribution 4,558,122 bytes; official Zod 4 documentation reports about 5.36 KB gzip for a minimal regular-Zod core import, subject to actual schema usage and esbuild output
- TypeScript: first-class inference and declarations
- Testability: deterministic `safeParse`; errors can be mapped to stable SelfGrow codes
- Selection reason: one schema can validate external JSON, AI results, provider responses, settings, checkpoints, and untyped Obsidian frontmatter while inferring the corresponding TypeScript type

Mobile/CSP rule: create one `schema/zod.ts` boundary, call `z.config({ jitless: true })` before any schema construction, and forbid direct imports elsewhere. Zod's current release notes state that early jitless configuration avoids eval probing. Tests must verify the configured import path.

Bounds must be checked before deeply validating attacker-controlled arrays or strings; schema validation is not a substitute for HTTP byte limits.

### Rejected: handwritten validators as the default

Concrete reason: the number of external and persisted contracts would duplicate type definitions and make omission errors likely. Small domain predicates may remain handwritten, but not the primary untrusted-object validation strategy.

## 5. Article DOM, Readability, Sanitization, and Markdown Conversion

### Selected: native `DOMParser`

- Version/license: supplied by the Obsidian desktop/mobile WebView platform
- Maintenance: follows the embedded browser engine
- Compatibility: browser-native on desktop and iOS; no Node or Electron API
- Size: zero plugin bundle bytes
- TypeScript: DOM library declarations
- Testability: production-path fixtures run in an actual browser/WebView; jsdom supplies deterministic development tests
- Selection reason: Readability accepts a browser `Document`, so a bundled server DOM implementation would duplicate the runtime platform

Parse fetched HTML with `DOMParser.parseFromString(html, "text/html")`; never attach the fetched document to the live UI. Set or inject a trusted base URL before resolving relative links, and remove resource-bearing elements before downstream conversion.

### Rejected for runtime: jsdom, happy-dom, and linkedom

Concrete reason: SelfGrow already runs in a DOM-capable WebView. jsdom is Node-only and the alternatives add a second, behaviorally different DOM implementation to mobile runtime without a capability gap.

### Selected: `@mozilla/readability` 0.6.0

- License: Apache-2.0
- Maintenance: evaluated package 0.6.0; repository remains active and is the standalone Firefox Reader View implementation
- Compatibility: official documentation supports direct browser use with a supplied `Document`
- Node assumptions: its package metadata lists a Node engine for development/use in Node, but the runtime library itself is usable in browsers and does not require jsdom there
- Size: npm unpacked distribution 154,574 bytes; moderate runtime impact, to be measured in the first extraction bundle
- TypeScript: bundled `index.d.ts`
- Testability: upstream fixture-oriented behavior plus SelfGrow complete/incomplete HTML fixtures
- Selection reason: it supplies the mature article-selection algorithm chosen by Task-003 and exposes title, content, text, author, language, and publication metadata

Use a cloned document because `Readability.parse()` mutates it. Set `maxElemsToParse`, keep the HTTP body bounded, and reject results that fail SelfGrow completeness rules.

### Selected: Obsidian `sanitizeHTMLToDom`

- Version/license: Obsidian API 1.13.2, MIT type package; implementation ships with Obsidian
- Maintenance/mobile: current public API on desktop and mobile
- Node assumptions: none
- Size: zero plugin bundle bytes
- TypeScript: current official signature returns `DocumentFragment`
- Testability: malicious HTML fixtures plus desktop and iPhone smoke tests
- Selection reason: it directly covers sanitization inside the host and avoids shipping a duplicate sanitizer

Only the sanitized fragment may be passed to `htmlToMarkdown` or rendered. SelfGrow still uses an allowlisted article shape and does not rely on sanitization to establish extraction completeness.

### Rejected for initial runtime: DOMPurify 3.4.13

- License: MPL-2.0 OR Apache-2.0
- Maintenance: active; evaluated latest package modified 2026-08-03
- Compatibility: modern browsers with TypeScript declarations; no Node dependency in a browser
- Size: npm unpacked distribution 1,768,071 bytes; actual browser artifact is much smaller but still duplicates a host capability
- Concrete rejection reason: Obsidian already exposes `sanitizeHTMLToDom`; adding DOMPurify now would create two sanitization policies and extra bundle weight. Reconsider only if security fixtures demonstrate a documented host-API gap.

### Selected: Obsidian `htmlToMarkdown`

- Size/runtime: zero plugin bundle bytes; mobile-capable host API
- Testability: fixture assertions for headings, lists, links, blockquotes, and code
- Selection reason: it prevents a second HTML-to-Markdown policy and aligns generated source Markdown with Obsidian behavior

### Rejected: Turndown 7.2.4

- License: MIT; actively published 2026-04-03; browser-compatible; TypeScript requires the separate `@types/turndown` package
- Size: npm unpacked distribution 191,636 bytes plus 7,131 bytes of types
- Concrete rejection reason: current Obsidian already provides `htmlToMarkdown`, so Turndown adds duplicate conversion behavior and configuration surface.

The selected generic-article pipeline is therefore:

```text
requestUrl with URL/host policy and bounded response
→ native DOMParser in an unattached document
→ Readability on a clone with element limits
→ Obsidian sanitizeHTMLToDom
→ Obsidian htmlToMarkdown
→ Zod/domain completeness validation
```

## 6. Markdown Section Parsing

### Selected: `mdast-util-from-markdown` 2.0.3

- License: MIT
- Maintenance: current evaluated package modified 2026-02-21; maintained in the unified/remark ecosystem
- Compatibility: ESM JavaScript without Node built-ins; browser-bundle compatible
- Node assumptions: none in runtime
- Size: npm unpacked distribution 97,286 bytes for the package itself, plus its micromark dependency graph; moderate bundle impact that must be measured after esbuild
- TypeScript: bundled declarations and mdast types
- Testability: deterministic AST and source-position fixtures for Chinese/English notes, fenced code, user whitespace, and ambiguous duplicate headings
- Selection reason: source offsets allow SelfGrow to locate canonical sections while splicing the original Markdown, preserving user formatting outside accepted replacement ranges

Rules:

- parse the exact string received inside `Vault.process()`
- identify one H1 title and each required H2 by localized canonical name
- reject missing, duplicated, reordered, nested, or otherwise ambiguous destructive ranges
- use node offsets to splice; do not serialize the whole mdast
- keep frontmatter handling in Obsidian APIs plus Zod validation

### Rejected: `remark-parse` 11.0.0 / full `remark`

- License: MIT; fully typed and browser-capable
- Maintenance: stable package line, but `remark-parse` 11.0.0 dates to 2023-11-20
- Size: `remark-parse` itself is 19,481 unpacked bytes but adds `unified` around the same mdast/micromark parser graph
- Concrete rejection reason: SelfGrow needs parsing and source positions, not a transformation pipeline or whole-document stringify. The lower-level package is the smaller, clearer boundary.

### Rejected: a regex-only section parser

Concrete reason: headings inside fenced code and duplicate localized headings make regex-only destructive replacement unsafe. A conflict must be reported rather than guessing.

## 7. Keyword Indexing

### Selected: MiniSearch 7.2.0

- License: MIT
- Maintenance: current 7.2.0 package and documented semantic-versioning/changelog; latest npm metadata modified 2025-09-16
- Compatibility: browser and Node, ES2018+, zero dependencies; intended for memory-constrained browser use
- Node assumptions: none
- Size: npm unpacked distribution 826,513 bytes; project changelog reports about 5.8 KB minified+gzip for its browser build, with final SelfGrow contribution to be measured
- TypeScript: bundled declarations
- Testability: deterministic scoring, serialization, add/remove/discard, field boosting, and fuzzy/prefix options
- Selection reason: it directly supports an in-memory, offline, incrementally updated index for the bounded SelfGrow corpus without a worker, server, or SQLite

Tokenizer policy:

- normalize Unicode and case without changing stored note text
- use `Intl.Segmenter` word segmentation for Chinese/English on the iOS 18 target
- index deterministic CJK bigrams as a recall fallback and keep query/index tokenization identical
- fix field boosts and fuzzy/prefix settings in code
- test Chinese, English, mixed-language, punctuation, and stable tie-breaking fixtures

MiniSearch supplies only the keyword score. SelfGrow combines its normalized keyword score with compatible embedding similarity using the fixed product weights.

### Rejected: FlexSearch 0.8.212

- License: Apache-2.0; browser-compatible and actively maintained; npm unpacked distribution 2,334,755 bytes
- Concrete rejection reason: its multiple index/document/worker/cache modes create more configuration and testing surface than the small personal corpus needs, while MiniSearch already covers incremental fielded search.

### Rejected: Lunr 2.3.9

- License: MIT; browser-compatible; npm unpacked distribution 976,211 bytes
- Concrete rejection reason: the package was last modified in 2023 and does not justify choosing an older maintenance line over MiniSearch for a new mobile-first implementation.

## 8. PDF Generation

Obsidian exposes PDF.js loading for PDF viewing, not a public mobile PDF-generation service. HTML printing and Electron APIs are desktop-only and are rejected.

### Conditional selection: jsPDF 4.2.1

- License: MIT
- Maintenance: evaluated release 4.2.1 published 2026-03-17; active browser test matrix and TypeScript declarations
- Compatibility: explicit browser ESM export; no Node API required in the selected text-layout path
- Node assumptions: avoid Node export and all raw filesystem examples
- Size: high impact; npm unpacked distribution 30,192,058 bytes includes multiple builds and artifacts. Official community installation downloads one bundled `main.js`, so the actual production-bundle and startup contribution must be measured during Task-037; a separate release chunk cannot be assumed.
- TypeScript: bundled declarations
- Testability: deterministic `Uint8Array` output structure, page count, extracted text, link annotations, and visual page renders; final acceptance requires real iPhone generation/open/share
- Selection reason: it is currently maintained, browser-first, can embed a custom font for Chinese, creates links, and returns bytes that Obsidian can write with `Vault.createBinary`

Constraints for Task-037:

- do not add jsPDF before Task-037; initialize the bundled module only when PDF export is requested, while recognizing that its code still increases `main.js` read/parse size
- use a canonical text renderer, not `html()`/canvas screenshotting
- embed a project-approved, redistributable CJK font with subsetting where supported; record font license and size
- implement deterministic wrapping, pagination, headings, source links, and page margins
- cap note count/content and report memory failures safely
- verify Chinese and English on Obsidian iOS before enabling the PDF option
- if the iPhone spike fails performance, font, link, or pagination acceptance, keep PDF unavailable and reopen the library decision

### Rejected: pdf-lib 1.17.1

- License: MIT; browser-compatible and TypeScript-first
- Maintenance: latest release is from 2021, despite a mature codebase
- Size: custom Unicode fonts require the additional `@pdf-lib/fontkit` package and font asset
- Concrete rejection reason: it is lower-level and less recently released than jsPDF, so SelfGrow would own more text layout/pagination code on a weaker maintenance signal.

### Rejected: browser print, Electron print, and server PDF services

Concrete reason: browser/Electron printing is not a supported Obsidian-iOS contract, and a server contradicts the local-first architecture and creates a new content-transmission surface.

## 9. Test Runner, DOM Tests, and HTTP Fixtures

### Selected development dependency: Vitest 4.1.10

- License: MIT
- Maintenance: stable release published 2026-07-24
- Compatibility: Node development tool requiring Node 20/22/24+; current Windows environment is Node 24.11.1
- Runtime impact: zero when kept in `devDependencies` and excluded from `main.js`; npm unpacked distribution 1,905,633 bytes
- TypeScript: first-class TypeScript/Vite integration
- Testability: fake timers, table tests, snapshots used only for safe non-secret structures, and coverage integration
- Selection reason: it fits the TypeScript/esbuild project and supports fast deterministic domain tests without loading Obsidian.

### Selected development dependency: jsdom 30.0.1

- License: MIT
- Maintenance: release/metadata modified 2026-07-29
- Compatibility: Node-only test environment requiring Node 22.22.2/24.15+/26+; current Node 24.11.1 satisfies the 24.x range only after upgrading to at least 24.15, so Task-005 must either upgrade Node or pin the newest compatible jsdom major/minor after rechecking its engine field
- Runtime impact: zero when dev-only; npm unpacked distribution 7,086,515 bytes
- TypeScript: package declarations/ecosystem types
- Selection reason: Readability's own Node examples and tests use jsdom, making it the closest deterministic DOM fixture environment for development.

Because the current Node 24.11.1 is below jsdom 30's declared 24.15 minimum, jsdom is a selected tool family but its install version is deliberately not pinned by Task-004. Task-005 must choose either a compatible jsdom release or an approved Node upgrade; it must not ignore the engine constraint.

### Selected fixture strategy: in-project `FixtureHTTPTransport`

Store allowed synthetic/public response fixtures in `tests/fixtures/http/` and map normalized request method+URL to immutable responses. The fixture transport must:

- never touch the network
- fail on an unknown request
- record request order and redacted headers
- support status, headers, body, redirects-as-fixtures, timeout, and oversized-body cases
- deep-copy returned data so one test cannot mutate another
- contain obviously fake secrets and no private captured bodies

Concrete selection reason: `HTTPTransport` is already an injected domain boundary, so a small fake is more deterministic and transparent than intercepting global network APIs.

### Rejected: Nock 14.0.17

- License: MIT; Node-only and actively maintained
- Concrete rejection reason: it intercepts Node HTTP while production uses Obsidian `requestUrl`; it would test the wrong boundary and cannot run in mobile runtime.

### Rejected: MSW 2.15.0

- License: MIT; active and TypeScript-capable; Node >=18 for development
- Size: npm unpacked distribution 6,048,017 bytes
- Concrete rejection reason: service-worker/Node interception is unnecessary when the application already injects `HTTPTransport`, and it would add a second request-matching system.

## 10. Dependency and Bundle Guardrails

Task-005 must establish:

- production dependencies bundled into `main.js`; `obsidian` remains external
- dev-only Vitest/jsdom excluded from production
- a production metafile or equivalent bundle report
- recorded raw and gzip `main.js` sizes
- a budget check after each newly imported runtime package
- no Node built-in polyfills in the mobile bundle
- no PDF dependency before Task-037 and a measured single-file production bundle when it is added
- license attribution for Apache-2.0 Readability and any later embedded font

Expected impact classes before the first real build:

| Item | Expected impact |
|---|---|
| Obsidian APIs / DOMParser | none in plugin bundle |
| Zod | small |
| Readability | small-to-moderate |
| mdast/micromark parser graph | moderate |
| MiniSearch | small |
| jsPDF + CJK font | large, deferred until Task-037; still part of the single release `main.js`/assets when approved |
| Vitest / jsdom | development install only |

These are planning classes, not substitutes for the esbuild measurements required when code exists.

## 11. Primary Sources

- [Obsidian API types 1.13.2](https://github.com/obsidianmd/obsidian-api)
- [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian SecretStorage guide](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Zod documentation](https://zod.dev/)
- [Zod 4 release notes](https://zod.dev/v4)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown)
- [remark](https://github.com/remarkjs/remark)
- [MiniSearch](https://github.com/lucaong/minisearch)
- [jsPDF](https://github.com/parallax/jsPDF)
- [pdf-lib](https://github.com/Hopding/pdf-lib)
- [Vitest](https://github.com/vitest-dev/vitest)
- [jsdom](https://github.com/jsdom/jsdom)
