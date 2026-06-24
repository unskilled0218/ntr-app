# Code review — 09 server/local conflict (round 1)

brooks-review (PR Review mode) on the implemented diff. Score: 94/100.

## 🟡 Warning — Knowledge Duplication: two renderings of the server todo.txt

`CONFLICT_IO.tasks.readServer` reads the server task file via `httpText("/api/raw")`,
but `backupTasksLocally` (task 07, unchanged) still rebuilds the same string with
`tasks.map(t => t.raw).join("\n") + (tasks.length ? "\n" : "")` after a
`GET /api/tasks`. Two modules now encode the todo.txt serialization; they must
agree byte-for-byte for the local mirror to stay consistent, and would silently
drift if the server's `raw()` format changed.

Remedy: route `backupTasksLocally` through `httpText("/api/raw")`; drop the join.

## 🟢 Suggestion — heading number disagreement

`ConflictDialog` renders `{label} differ from the server` → "Note differ" for the
singular note resource. Use a number-agnostic heading.

See `review-plan.md` for the fix plan.
