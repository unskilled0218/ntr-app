# Projects

- [Rename a project](#rename-a-project)
- [Remove a project](#remove-a-project)
- [Staged-only choices](#staged-only-choices)
- [Partial completion and review](#partial-completion-and-review)
- [Drafts and connections](#drafts-and-connections)
- [Concurrency limits](#concurrency-limits)

## Rename a project

Open a Project selector, choose its pencil icon, enter a name, and confirm. Existing target names are rejected rather than merged. Cancel before submission makes no changes. Rename from the create-task selector returns to that picker; compact Task options remain underneath.

For local/file-backed tasks, rename updates matching references in active/completed tasks and remembered choices without changing unrelated content. For HA, it changes the list's display name, not its identity or task text; see [HA projects](server-connection.md#home-assistant-tasks).

## Remove a project

Choose its trash icon and confirm. Local removal clears references and remembered choices, never the tasks themselves. A task needs meaningful content after removal. HA deletion instead removes a confirmed empty Local To-do list; the default list is protected.

## Staged-only choices

A project used only in an unsaved draft changes only that draft. If it becomes globally known or belongs to an unfinished operation, reopen its confirmation for the current scope. Other draft fields stay intact.

## Partial completion and review

Writes are sequential, not transactional. The dialog cannot close while a write attempt runs. Completed changes remain if a later step fails. Reopen the result through its related selector icon or `Resume unfinished rename/removal` entry.

Retry revalidates current tasks and writes only remaining work. `Finish labels` handles a label-only failure. An uncertain label write is checked before another PUT. `Review update` closes the operation's dialog stack before remote approval; approval never resumes writes. Reopen the result and explicitly retry. `Stop retry; keep partial changes` releases retry authority without undoing accepted changes.

## Drafts and connections

Full success updates matching selected/staged references in add/edit drafts. Partial work keeps ambiguous source-project submissions blocked. Suspended edits adopt only verified own task responses; unrelated task changes still require a new edit action.

Progress belongs to the captured destination and mounted pane, not a restart-persistent journal. Connection changes stop follow-up writes but cannot recall issued requests. Another destination cannot acquire an older operation's write authority. Pending note approval remains independent.

## Concurrency limits

Task/label validation is not compare-and-swap. Other clients can write between reads and writes; avoid simultaneous edits when both versions must survive. Remembered-label-only changes have no dedicated event and appear on a later deliberate label read. Old names are not permanent aliases and may be created again.
