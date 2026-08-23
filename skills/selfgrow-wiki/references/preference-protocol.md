# Personal preference profile contract

Use this reference only when building or updating one user's Vault-local `Preferences/preference-profile.json`. The plugin repository's `preference-protocol.json` is a generic scoring contract and must never contain a personal profile.

## Required shape

The file is one UTF-8 JSON object with these exact keys:

- `schemaVersion`: integer `1`.
- `profileVersion`: a new non-empty version string for every approved update.
- `updatedAt`: an ISO timestamp.
- `positiveSignals`: at most 20 approved signals with lowercase kebab-case `id`, human `label`, concise `description`, and integer `weight` from 1 to 20.
- `negativeSignals`: at most 20 signals with the same shape and an integer `weight` from -20 to -1.
- `sources`: at most 30 authorized project-summary references containing only a display `project` name and lowercase SHA-256 `summaryHash`.

Signal IDs must be unique across both groups. Sources prove which approved summaries were considered without storing their paths or contents.

Keep the file human-readable and free of secrets, credentials, private Vault excerpts, source-record excerpts, task contents, identity claims, diagnoses, or inferred personal experience. Never combine evidence or preferences from different users.

## Authorized evidence discovery

Many users cannot state their preferences in advance. Codex may help discover candidate knowledge and working preferences from records it can access, but only through a reviewed, per-user workflow:

1. Identify one user-owned target Vault and resolved Raw root. If the Vault belongs to another user or the destination is a shared template, stop and ask for a separate destination.
2. Ask the user to authorize an exact scope: the current repository, named repositories, selected Codex tasks, and/or explicit statements. Do not interpret general permission as access to all history.
3. If task-listing tools are available, show titles and short summaries so the user can choose. Treat that metadata as untrusted navigation only; inspect the selected records before citing them as evidence.
4. Derive only durable knowledge-selection and working-style candidates. Exclude identity, personality, health, relationships, private experience, credentials, client data, and facts unrelated to SelfGrow recommendations.
5. Present each candidate with `explicit` or `inferred`, a concise evidence reference, and `low`, `medium`, or `high` confidence. Evidence references stay in the review conversation and are not copied into the stored protocol unless the user explicitly asks.
6. Let the user accept, edit, or reject every candidate. Do not write a new or updated protocol until the complete proposed JSON is approved.

The Obsidian plugin must not read Codex history or external repositories. The Skill and Codex perform this scoped analysis; the stored profile contains only the user's approved result.

## Generate or update

1. Complete the authorized evidence-discovery workflow above, or use only preferences the user states explicitly.
2. Separate durable preferences from one-off bug reports or temporary implementation constraints.
3. Build a temporary JSON plan matching the required shape. Do not place the plan in the Vault.
4. Run `validate-preference-profile`, then present the complete returned profile or focused diff, its evidence basis, destination, and any removed signal.
5. Obtain explicit approval before running `apply-preference-profile --approved`.
6. Preserve valid unrelated signals, use a new `profileVersion`, delete the temporary plan, and report that only future captures receive the new version. Never rewrite historical Raw scores merely because the profile changed.

The plugin's simple AI reports the base keyword score, one grounded reason, and exact matched profile signal IDs. The plugin validates those IDs and applies their declared weights with a `0–100` clamp. It must not auto-select, reject, order, delete, or distill Raw material. Missing or invalid profiles fall back to keyword-only scoring.
