# Task-003 Extraction Feasibility Report

Date: 2026-08-07  
Status: Completed research spike; implementation remains in later tasks  
Scope: Generic articles, YouTube, Bilibili, Xiaohongshu, Douyin, WeChat Official Accounts, and the observed Weibo clipboard route

## 1. Decision

The first minimal end-to-end extractor is a local generic-article adapter:

```text
Obsidian requestUrl
→ bounded HTML response
→ DOM parse without script execution
→ Mozilla Readability
→ sanitized main text
→ completeness checks
→ AI generation
```

This slice is useful without another paid service, exercises the complete processing pipeline, and uses a mature implementation instead of a new article-selection algorithm.

Priority social platforms use separate adapters behind the common `ContentExtractor` contract. Anonymous extraction may be attempted where it is currently useful, but undocumented page state is opportunistic rather than the reliability boundary. A configurable third-party social extraction provider is the supported reliability path. The initial provider candidate is TikHub because its current public OpenAPI specification exposes relevant detail, article, stream, and subtitle endpoints across the priority platforms. It is not hard-coded as the only provider.

No extractor may return `complete` from a title, description, thumbnail, comments, danmaku, or play URL alone. A video without usable subtitles or a transcript remains `incomplete_extraction` until a selected provider supplies a transcript or a separately approved audio-transcription route exists.

## 2. Test Method

- Captured-text, anonymous direct, and third-party routes were evaluated separately.
- Redirects were followed with bounded public HTTP requests.
- Tests recorded status, final host, structured-data presence, and content completeness; source bodies, share tokens, Cookies, and credentials were not persisted.
- User queue tokens identify the four mobile fixtures without reproducing tracking parameters.
- Provider capability means the current documented endpoint exists. It does not prove that every public item is available or complete, so provider activation still requires a connection and capability test.

## 3. Observed Fixtures

| Fixture | Source | Anonymous observation | Completeness | Required production route |
|---|---|---|---|---|
| `20260807-161039` | Xiaohongshu image/text note | Short link resolved; the public page contained structured note title, description, and seven images | Complete for this text/image note, but the page-state shape is undocumented | Anonymous adapter with strict fixtures, then configured provider if it breaks or content is gated |
| `20260807-161122` | Bilibili video | Public metadata returned one video part; the tested subtitle list was empty | Incomplete: metadata and description are not a transcript | Provider subtitle endpoint when captions exist; otherwise transcript/ASR route or incomplete |
| `20260807-161157` | Weibo post | Direct and mobile endpoints redirected to the Sina Visitor System | Incomplete | Configured provider; do not add a brittle visitor-system bypass |
| `20260807-162200` | Douyin video | Short link resolved and public HTML exposed title/description, but no transcript; tested public detail calls were unavailable | Incomplete | Configured provider for detail/media, plus transcript capability; otherwise incomplete |
| public Mozilla Reader View article | Generic article | Direct HTML contained article metadata; Jina Reader also returned title and main body in a no-key public test | Complete | Local Readability is selected first; Jina/Firecrawl remain optional provider candidates |

The Bilibili fixture's absence of subtitles is a property of that sample, not evidence that Bilibili never exposes subtitles.

## 4. Platform Findings

### Generic public articles

`@mozilla/readability` returns title, HTML content, plain text, excerpt, author, language, and publication metadata. Its official security guidance says untrusted output must be sanitized and scripts/resources should not run. SelfGrow therefore pairs it with a DOM implementation and sanitizer selected in Task-004. The local path sends no article body to an extraction provider, although the resulting text is still sent to the user's configured Chat endpoint for summarization.

Optional remote alternatives:

- Jina Reader converts a URL to LLM-friendly text, supports a no-key basic tier, and necessarily receives the URL and fetched page content.
- Firecrawl returns Markdown/HTML and can render dynamic pages; current documentation prices a normal scrape at one credit and adds credits for advanced formats. It also receives the URL and page content.

Neither remote service is needed for the first vertical slice.

### YouTube

The official YouTube Data API can list caption tracks only with OAuth, while `captions.download` requires authorization and permission to edit the video. It is not a general arbitrary-public-video transcript API. TikHub's current specification exposes YouTube caption and asynchronous caption-result endpoints, but SelfGrow must validate actual transcript content and supported languages before reporting success.

### Bilibili

Anonymous web metadata and a subtitle-list call worked for the sample, but that sample had no subtitles. Bilibili's official open platform centers on authorized account and creator capabilities rather than a documented arbitrary-public-transcript contract. TikHub currently documents video-detail, play-URL, and subtitle endpoints. A play URL is input for a possible future transcription stage, not complete knowledge by itself.

### Xiaohongshu

The tested public image/text note exposed complete caption text in page state. That state is undocumented and may change, so the parser must be fixture-tested and isolated. The reviewed official Xiaohongshu developer material covers mini-app and authorized business capabilities; no documented general public note-reading API was found. TikHub currently documents a note-detail endpoint requiring note ID and the page's `xsec_token`.

### Douyin

The tested public page exposed useful metadata but no transcript. Douyin Open Platform video APIs require an application, permission, and user authorization and describe authorized-user video data, not arbitrary shared-video transcripts. TikHub documents single-video detail endpoints, but detail/media still must not be treated as transcript completeness.

### WeChat Official Accounts

Official-account publication APIs operate with the account owner's access token and retrieve that account's published articles; they are not an arbitrary public-article reader. A public article should first try bounded generic HTML extraction. TikHub currently documents a WeChat article-detail endpoint and a cached demonstration extractor, making it a candidate fallback for gated or dynamic pages.

### Weibo

Weibo is not part of the original priority list, but the iOS clipboard route was validated and this test showed anonymous access can be blocked by visitor verification. It is supported only through the generic/provider pipeline in V1; no dedicated anonymous bypass is planned.

## 5. Route Policy

For every URL, run the least invasive sufficient route:

1. Accept captured text only when it passes the same completeness and source checks as fetched content.
2. For generic articles, run the local Readability adapter.
3. For a priority platform, run a small platform adapter only when its structured response is understood and fixture-tested.
4. If configured and disclosed, send the URL and only the minimum necessary credential or source data to the selected extraction provider.
5. Return `incomplete_extraction` when main article text or transcript is still missing.

Do not automatically send platform Cookies. V1's default TikHub-style public-data endpoints use the provider API token; any later endpoint requiring a platform session secret needs a separate explicit design and consent review.

## 6. Provider Comparison

| Route | Cost | Region/availability | Data and credentials sent | Maintenance risk | Decision |
|---|---|---|---|---|---|
| Local Readability | No per-request provider cost | Runs inside Obsidian; target site must be reachable | URL goes to target site; extracted text later goes to configured Chat API | Low library risk; page-specific failures remain | Selected first extractor |
| Anonymous platform parsing | No provider fee | Depends on target platform reachability and anti-bot behavior | URL goes to target platform; no provider token | High because undocumented page state changes | Opportunistic only |
| TikHub | Current advertised pay-as-you-go range is USD 0.001–0.01/request; endpoint-specific pricing applies | External service availability and the usable regional host must pass the on-device connection test | Provider receives URL/content identifiers and Bearer token; some specialized endpoints may require more | Provider/schema/policy dependency | Initial configurable social-provider candidate |
| Jina Reader | Basic no-key access is currently available; keyed tiers are token-based | External rendering service must be reachable | Provider receives URL and rendered content; optional API key | General-page behavior and service dependency | Optional generic fallback, not V1 default |
| Firecrawl | One credit for a basic scrape; advanced formats add credits | External rendering/proxy service must be reachable | Provider receives URL/content and optional API key | Feature-rich but wider dependency and cost surface | Not selected for first slice |

The user must see the disclosure before enabling a third-party extractor. `Test Connection` must verify authentication, one generic detail response, one body/article capability, and one subtitle capability where applicable. A successful health check alone is insufficient.

## 7. Error and Completeness Rules

Stable incomplete reasons for the first implementation:

```text
main_text_missing
transcript_missing
login_required
provider_not_configured
provider_capability_missing
provider_response_invalid
source_unreachable
```

Provider and platform failures are user-safe. Logs contain host, adapter ID, status/error code, timing, and response size only—never the source body, response payload, Authorization header, Cookie, share token, or user note.

## 8. Implementation Sequence

1. Task-004 selects the mobile-compatible DOM parser, sanitizer, runtime schema validator, and test fixture stack after checking current dependencies and types.
2. Task-005 scaffolds the plugin.
3. The first extraction implementation is generic `requestUrl` + Readability with one complete public article fixture and incomplete fixtures.
4. Add platform URL normalization and observed metadata adapters without claiming completion.
5. Add the configurable social-provider adapter and capability test.
6. Add subtitle/transcript paths one platform at a time; keep no-subtitle video incomplete until a verified route exists.

## 9. Primary Sources Reviewed

- [Obsidian plugin review guidelines](https://docs.obsidian.md/oo/plugin)
- [Obsidian `request` API reference](https://docs.obsidian.md/Reference/TypeScript%20API/request)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [YouTube caption download API](https://developers.google.com/youtube/v3/docs/captions/download)
- [YouTube caption implementation guide](https://developers.google.com/youtube/v3/guides/implementation/captions)
- [Douyin Open Platform video data](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/video-data/)
- [Douyin Open Platform permissions](https://open.douyin.com/platform/resource/docs/accession-guide/type-and-permission)
- [Bilibili Open Platform](https://openhome.bilibili.com/doc)
- [Xiaohongshu Mini Program platform](https://miniapp.xiaohongshu.com/home)
- [WeChat publication records API](https://developers.weixin.qq.com/doc/offiaccount/Publish/Get_publication_records.html)
- [TikHub current API reference](https://tikhub.io/api-reference)
- [TikHub current pricing](https://tikhub.io/pricing)
- [Jina Reader](https://jina.ai/reader/)
- [Firecrawl scrape documentation](https://docs.firecrawl.dev/features/scrape)
