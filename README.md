# SelfGrow

SelfGrow is a local-first Obsidian plugin that turns links, shared text, images, PDF documents, Markdown files, and GitHub repositories into reviewable Raw cards. You decide which cards are worth keeping before optionally distilling them into a linked Wiki.

## Features

- Capture URLs, shared text, direct notes, images, and local attachments.
- Extract readable text from `.pdf`, `.md`, and `.markdown` files.
- Preserve complete source evidence and retained attachments in the Vault.
- Generate titles, previews, categories, and optional preference-based recommendation scores with a user-configured AI provider.
- Review Raw cards on desktop and mobile before selecting anything for Wiki distillation.
- Resolve GitHub repository names and preserve README Markdown, links, images, tables, and code blocks.
- Keep Wiki writes behind a visible proposal and explicit approval through the bundled `selfgrow-wiki` agent skill.

## Requirements

- Obsidian 1.13.0 or later.
- Desktop, iOS, or Android. SelfGrow does not use Node.js or Electron runtime APIs.
- An API key is required only for AI-assisted features. Local capture and storage remain available without one.

## Install

After SelfGrow is listed in the Obsidian Community directory:

1. Open **Settings → Community plugins → Browse**.
2. Search for **SelfGrow**.
3. Select **Install**, then **Enable**.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub release and place them in:

```text
<Vault>/.obsidian/plugins/selfgrow/
```

Restart Obsidian after installing or updating the plugin.

## Quick start

1. Open **Settings → SelfGrow** and choose the Raw root and language.
2. Configure an AI provider if you want generated titles, previews, document summaries, visual understanding, or recommendation scores.
3. Run **SelfGrow: Open queue** to collect material.
4. Run **SelfGrow: Open knowledge review** to review, categorize, select, or delete Raw cards.
5. If you use the bundled `selfgrow-wiki` skill, review its proposed Wiki changes and approve them explicitly before it writes anything.

The complete guide is available in [docs/user-guide.md](docs/user-guide.md).

## PDF and Markdown documents

- Supported document extensions are `.pdf`, `.md`, and `.markdown`.
- PDF extraction requires a usable text layer. Scanned PDFs without selectable text currently require external OCR before capture.
- SelfGrow asks for explicit authorization before sending extracted document text to the configured AI provider.
- Without that authorization, the selected document is retained as direct material and is not summarized by AI.

## Privacy and network disclosure

SelfGrow has no client-side telemetry and does not operate a SelfGrow account or server. Raw cards, Wiki pages, attachments, preferences, and plugin settings are stored in the current Obsidian Vault.

Network access occurs only for features initiated or configured by the user:

- **AI providers:** OpenAI, DeepSeek, Qwen, Kimi, or a custom OpenAI-compatible endpoint. Source excerpts, authorized document text, selected preference signals, and images when visual processing is enabled may be sent to the configured provider. API keys are referenced through Obsidian SecretStorage.
- **GitHub:** GitHub API, repository pages, and raw content hosts are used to resolve repositories and retrieve README content.
- **Platform metadata:** YouTube and Bilibili public endpoints may be queried for supported links.
- **Optional extraction providers:** TikHub or a custom extraction endpoint is used only after the user enables it and accepts the in-app disclosure.

SelfGrow does not send browser cookies, platform passwords, Vault paths, unrelated notes, or source-project records to these services. Review each provider's terms and privacy policy before enabling it.

## Development

Requires Node.js 20+ and npm 11+.

```bash
npm ci
npm run check
```

The production build creates `main.js`. The same command used by CI runs formatting checks, lint, tests, type checking, and the production build.

## License

SelfGrow is released under the [MIT License](LICENSE). Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Project contributors are acknowledged in [CONTRIBUTORS.md](CONTRIBUTORS.md).
