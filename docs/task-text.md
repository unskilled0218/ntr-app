# Task text and compatibility

- [Task text and compatibility](#task-text-and-compatibility)
- [Legacy data](#legacy-data)
- [Editing safely](#editing-safely)
- [Backend versions](#backend-versions)

## Legacy data

Priority cannot be selected, displayed as a dedicated field, sorted, or filtered. Existing `ntr.sort=priority` settings fall back to file order; ascending or descending direction stays unchanged.

Existing leading uppercase `(A)`–`(Z)` tokens remain hidden legacy data. They stay before lifecycle dates, immediately after `x ` on completed lines. Local storage and server `0.2.8` preserve these tokens through edits, completion, reopening, and unrelated writes. Reading does not migrate files. No lifecycle action creates or converts priority metadata. Raw file interfaces still accept existing lines for lossless import and editing.

Every `pri:` occurrence is ordinary visible, editable description text, including repeated identical and distinct tokens. An unchanged edit retains their order; changing or deleting them does not restore values from the parsed tags map. Projects, contexts, due dates, custom tags, creation/completion dates, and edit-day `updated:` stamps retain their existing behavior.

## Editing safely

The format cannot distinguish a newly typed leading `(A)`–`(Z)` token from legacy data. Add and edit reject descriptions beginning with a complete uppercase token, including `(A)` alone, with an inline explanation and no write. Input, project, and due date stay available for correction. Move the token later in the text if it is intended as ordinary text. Malformed lookalikes such as `(A)call`, `(a) call`, and `(AA) call`, plus embedded `call (A)` tokens, remain ordinary text.

This guard also applies when an existing visible description starts with `(A)` after lifecycle dates, such as `2026-06-01 (A) call`; unchanged form submissions are rejected too. The stored line remains untouched. Move the visible token later before saving. This is distinct from an existing hidden prefix recovered from raw text, which an unchanged edit preserves automatically.

The edit serializer recovers only the hidden leading token from `raw`, never from an older response's `priority` field. Parsed DTO dates and description remain authoritative. Before saving, it checks that raw text is nonempty and single-line, has the same completion state, parses to the same lifecycle dates, and has the same description. Missing or inconsistent raw data fails visibly without writing; reload or upgrade the server rather than guessing. A completed task with a creation date but no completion date cannot be safely reconstructed and also fails.

## Backend versions

Client `0.15.18` with local storage or server `0.2.8` provides the full preservation guarantee. An older server's extra JSON fields are tolerated; valid `raw` lets the new client preserve legacy data during edits. Completion and reopening on an older server are excluded: it can move a leading token into `pri:X` on completion and consume the first valid `pri:X` on reopening, even when that token was intended as ordinary text. Upgrade the server before these actions if exact preservation matters.

Older clients with the new server are unsupported for priority-dependent behavior. Any HTTP `priority` query returns HTTP 400, including empty, invalid, and repeated values. The local Tauri `list_tasks` boundary accepts omitted or null legacy `priority` arguments but rejects every non-null value before reading the store. New client calls omit this argument.
