# Preference protocol contract

Use this reference only when initializing or updating `preference-protocol.json` in a SelfGrow source repository.

## Required shape

The file is one UTF-8 JSON object with these keys:

- `version`: update date or another monotonically advancing version string.
- `basis`: what repository evidence supported the protocol and what was excluded.
- `purpose`: advisory scoring only; never automatic selection or deletion.
- `preferences`: concise, durable positive working preferences.
- `downrank`: low-signal or unwanted characteristics.
- `rubric`: meanings for `0-39`, `40-59`, `60-79`, and `80-100`.

Keep the file human-readable and free of secrets, credentials, private Vault excerpts, identity claims, diagnoses, or inferred personal experience. Base changes only on observable repository decisions or on preferences the user states explicitly.

## Generate or update

1. Read the repository status, product specification, current protocol, and relevant accepted project decisions.
2. Separate durable preferences from one-off bug reports or temporary implementation constraints.
3. Present the proposed protocol or focused diff, its evidence basis, and any removed preference.
4. Obtain explicit approval before storing a new personal-preference profile or changing an existing one.
5. Update `version`, preserve valid unrelated preferences, run the repository validation, and report that only future captures receive the new version. Never rewrite historical Raw scores merely because the protocol changed.

The plugin's simple AI may use the protocol only to emit a `0-100` advisory score and one grounded reason. It must not auto-select, reject, order, delete, or distill Raw material.
