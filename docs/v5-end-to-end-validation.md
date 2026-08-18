# V5 End-to-End Validation

Validated on 2026-08-11.

## User-observed checkpoints

- Desktop and iPhone/iCloud capture paths produced flat Raw cards for links, shared text, and pure-image input with retained attachments.
- Existing Raw opened unselected; select, cancel, changed-content detection, and renewed confirmation were exercised.
- The approved Codex batch created three linked Wiki pages and one promoted image asset.
- Obsidian's native local graph showed Index, Log, and the three Wiki pages connected by ordinary wikilinks.

## Automated safety boundaries

- Discovery and proposal validation are read-only.
- Apply requires an exact approved Raw body hash and explicit `--approved`.
- Wiki updates preserve the complete `## 我的经验` suffix byte-for-byte.
- Raw deletion removes its URL identity and only unreferenced Raw attachments; Wiki prose and promoted assets remain.
- Maintenance reports before writing, removes only approved explicit broken `Knowledge/...` links outside the protected section, and never automatically rewrites lint findings.
- Recollected content is a new Raw and selection decision.

## Final gate

- Plugin: formatting, lint, source/test typechecking, 218 tests in 31 files, production build.
- Skill: Python compilation, isolated self-test, official structural validation.
- Bundle: 489,609 bytes raw; 114,294 bytes gzip.
- SHA-256: `3DAF0D9C0628D9984F86F835964A5F0566A5D42C687EAD3E50C53C37885EC5F4` for source, desktop install, and iPhone install.
