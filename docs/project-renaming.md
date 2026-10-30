# Project renaming

- [Project renaming](#project-renaming)
  - [Rename a project](#rename-a-project)
  - [Partial completion and review](#partial-completion-and-review)
  - [Drafts and connections](#drafts-and-connections)
  - [Concurrency limits](#concurrency-limits)

## Rename a project

Open Project filter and choose Rename beside a concrete project. In compact mode, open Filter options first. Enter the new name and confirm Rename. Names follow the existing project-name rules and remain case-sensitive. Existing target projects are rejected rather than merged; submitting the unchanged name performs no writes. Cancel, Escape, and backdrop dismissal before submission change nothing.

The app changes exact `+old` tokens in all associated active and completed tasks and updates remembered projects. Other projects, contexts, dates, legacy prefixes, task metadata, and note content are preserved. Similar names such as `+oldish` are not changed. Remembered-only projects can also be renamed. The active source filter follows the new name after successful completion.

## Partial completion and review

Writes are sequential and are not a transaction. The dialog shows progress and cannot be dismissed while an attempt is running. A slow validation read waits instead of truncating the operation; actual remote divergence stops further writes. Successful task responses remain applied even if a later task or label write fails.

Close, Escape, or backdrop dismissal after an attempt stops hides the dialog without rolling anything back. Review rename progress reopens the retained result. Retry rename validates current content and writes only remaining work; Finish labels completes a label-only failure. A verified intended label result after a lost response does not cause a duplicate write. Unexplained target references remain conflicts rather than being treated as the operation's own progress.

For remote task divergence, choose Review update inside the rename dialog. It releases that dialog before showing the usual approval question. Approval never resumes the rename. Reopen its progress and explicitly confirm retry after reviewing current content. If progress can no longer be safely reconciled, Stop retry; keep partial changes deliberately forgets retry authority and releases draft restrictions. Existing changes remain; it does not merge projects or undo them.

## Drafts and connections

On full success, matching selected/staged project names and exact inline project tokens in local add/edit drafts follow the rename. Other draft fields stay intact. A suspended edit draft uses only its own verified renamed task as its new persistence baseline; unrelated task changes retain stale-edit protection. During a partial rename, submitting an ambiguous source-project draft is blocked until the operation is finished or explicitly resolved. Pending remote notes and their paused autosave status are independent of task renaming.

Each attempt belongs to one captured transport and destination. Connection changes and unmount stop follow-up writes; an issued request cannot be recalled. Retained progress does not authorize writes to another destination. Same-destination retry requires revalidation and explicit confirmation. Results are held in the mounted pane, not a durable operation journal across app restarts.

## Concurrency limits

Fresh task validation and latest-label reads narrow conflicts but do not provide compare-and-swap. Another client can still write between GET and PUT. Whole-label replacement remains last-write-wins; older clients may later restore a source name from cached labels. Verification establishes observed completion, not reliable author attribution or a permanent global rename invariant. Avoid simultaneous edits when all versions must survive.

Labels-only changes have no dedicated server SSE notification. Another connected client discovers a remembered-only rename on its next deliberate label read. No fake task event or note approval is used to simulate label synchronization. A user may deliberately create the old name again in a later independent action; there is no permanent alias or redirect.
