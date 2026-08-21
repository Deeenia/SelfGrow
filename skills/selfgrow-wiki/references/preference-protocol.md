# Preference protocol contract

Use this reference only when initializing or updating `preference-protocol.json` in one user's own SelfGrow source repository.

## Required shape

The file is one UTF-8 JSON object with these keys:

- `version`: update date or another monotonically advancing version string.
- `basis`: what repository evidence supported the protocol and what was excluded.
- `purpose`: advisory scoring only; never automatic selection or deletion.
- `preferences`: concise, durable positive working preferences.
- `downrank`: low-signal or unwanted characteristics.
- `rubric`: meanings for `0-39`, `40-59`, `60-79`, and `80-100`.

Keep the file human-readable and free of secrets, credentials, private Vault excerpts, source-record excerpts, task contents, identity claims, diagnoses, or inferred personal experience. Never combine evidence or preferences from different users.

## Authorized evidence discovery

Many users cannot state their preferences in advance. Codex may help discover candidate knowledge and working preferences from records it can access, but only through a reviewed, per-user workflow:

1. Identify one user-owned target protocol. If the checkout is a shared template or belongs to another user, stop and ask for a separate destination.
2. Ask the user to authorize an exact scope: the current repository, named repositories, selected Codex tasks, and/or explicit statements. Do not interpret general permission as access to all history.
3. If task-listing tools are available, show titles and short summaries so the user can choose. Treat that metadata as untrusted navigation only; inspect the selected records before citing them as evidence.
4. Derive only durable knowledge-selection and working-style candidates. Exclude identity, personality, health, relationships, private experience, credentials, client data, and facts unrelated to SelfGrow recommendations.
5. Present each candidate with `explicit` or `inferred`, a concise evidence reference, and `low`, `medium`, or `high` confidence. Evidence references stay in the review conversation and are not copied into the stored protocol unless the user explicitly asks.
6. Let the user accept, edit, or reject every candidate. Do not write a new or updated protocol until the complete proposed JSON is approved.

The Obsidian plugin must not read Codex history. The Skill and Codex perform this scoped analysis; the stored protocol contains only the user's approved result.

## Generate or update

1. Complete the authorized evidence-discovery workflow above, or use only preferences the user states explicitly.
2. Separate durable preferences from one-off bug reports or temporary implementation constraints.
3. Present the complete proposed protocol or focused diff, its evidence basis, and any removed preference.
4. Obtain explicit approval before storing a new personal-preference profile or changing an existing one.
5. Update `version`, preserve valid unrelated preferences, run the repository validation, and report that only future captures receive the new version. Never rewrite historical Raw scores merely because the protocol changed.

The plugin's simple AI may use the protocol only to emit a `0-100` advisory score and one grounded reason. It must not auto-select, reject, order, delete, or distill Raw material.
