# Project renaming

- [Project renaming](#project-renaming)
  - [Rename a project](#rename-a-project)
  - [Remove a project](#remove-a-project)
  - [Staged-only choices](#staged-only-choices)
  - [Partial completion and review](#partial-completion-and-review)
  - [Drafts and connections](#drafts-and-connections)
  - [Concurrency limits](#concurrency-limits)

## Rename a project

Open Project filter or the create-task Project selector and choose the pencil icon beside a concrete project. In compact mode, open Filter options or Task options first. Enter the new name and confirm Rename. Names follow the existing project-name rules and remain case-sensitive. Existing target projects are rejected rather than merged; submitting the unchanged name performs no writes. Cancel, Escape, and backdrop dismissal before submission change nothing. Icon buttons retain project-specific accessible names and tooltips.

The simplified dialog shows Rename project, Original, and New project name using the selector's visual style. Successful completion, including an unchanged-name submission, closes rename automatically; failures and partial results stay recoverable. Rename opened from the create-task selector sits above that same selector. Cancel, Escape, backdrop dismissal, successful rename, and explicit stop-retry return to the still-open picker, including Task options underneath in compact mode. Focus returns to the related row after updated choices commit. Removal, Add project, and filter-origin actions retain their close-before-replacement handoff.

The app changes exact `+old` tokens in all associated active and completed tasks and updates remembered projects. Other projects, contexts, dates, legacy prefixes, task metadata, and note content are preserved. Similar names such as `+oldish` are not changed. Remembered-only projects can also be renamed. The active source filter follows the new name after successful completion.

## Remove a project

Choose the trash icon beside a project in either selector, then confirm Remove. This removes the exact project token from associated tasks and removes the remembered choice; it never deletes the tasks themselves. Successful completion also retires matching selected/staged/inline draft project references while preserving unrelated text and fields. Cancel before submission leaves everything unchanged. A task whose only content is the project token may need meaningful text added before its project can be removed without creating an empty task.

Removal retains task/label progress independently of its dialog. Retry removal revalidates current content and changes only remaining source references. Finish labels handles a label-only failure; uncertain successful label writes are verified before issuing another PUT. Partial or uncertain work does not emit a successful draft mapping or silently release guarded source references.

## Staged-only choices

Projects added through Add project but not yet used in stored tasks or remembered choices can be draft-local. Their pencil/trash confirmations explicitly say that only this draft changes; no native/server writes occur. Renaming changes matching staged, selected, and inline project references. Removing a staged choice clears matching project references, not the rest of the task description or due date. If the project becomes globally known before confirmation, reopen the selector for a new scope confirmation.

A same-destination unfinished operation takes precedence over this classification. Its old source may still be staged after stored choices move to the target; that row's action reopens the retained global result instead of starting a fresh local mutation. Names on another destination are classified independently.

## Partial completion and review

Writes are sequential and are not a transaction. The dialog shows progress and cannot be dismissed while an attempt is running. A slow validation read waits instead of truncating the operation; actual remote divergence stops further writes. Successful task responses remain applied even if a later task or label write fails.

Close, Escape, or backdrop dismissal after an attempt stops hides its dialog without rolling anything back. Reopen a project selector and use the related pencil/trash action to reopen that exact result. The row's accessible description identifies unfinished work. If related project names no longer appear, the selector offers a separate Resume unfinished rename/removal action; it is not a selectable project. There is no standalone progress button outside the selectors. Retry rename/removal validates current content and writes only remaining work; Finish labels completes a label-only failure. A verified intended label result after a lost response does not cause a duplicate write. Unexplained target references remain conflicts rather than being treated as a rename's own progress.

For remote task divergence, choose Review update inside the operation dialog. It releases that dialog and any retained originating picker/Task options before showing the approval diff. Approval never resumes writes or reopens the old stack. Reopen the result through a selector and explicitly confirm retry after reviewing current content. Another global project action on that destination cannot overwrite the retained result. If progress can no longer be safely reconciled, Stop retry; keep partial changes deliberately forgets retry authority and releases that result's draft restrictions. Existing changes remain; it does not merge projects or undo them.

## Drafts and connections

On full success, matching selected/staged project names and exact inline project tokens in local add/edit drafts follow the rename or removal. Other draft fields stay intact. A suspended edit draft uses only a matching verified own task response as its new persistence baseline; unrelated task changes retain stale-edit protection. During a partial operation, submitting an ambiguous source-project draft is blocked until that operation is finished or explicitly resolved. Pending remote notes and their paused autosave status are independent of task operations.

Each attempt belongs to one captured transport and destination. Connection changes and unmount stop follow-up writes; an issued request cannot be recalled. The pane retains at most one unfinished project operation per destination and runs one write attempt at a time. A separate destination-labelled recovery entry can show an older result read-only, without hijacking the same bare project name on the current destination. Retained progress does not authorize writes elsewhere. Same-destination retry requires revalidation and explicit confirmation. Results are held in the mounted pane, not a durable operation journal across app restarts.

## Concurrency limits

Fresh task validation and latest-label reads narrow conflicts but do not provide compare-and-swap. Another client can still write between GET and PUT. Whole-label replacement remains last-write-wins; older clients may later restore a source name from cached labels. Verification establishes observed completion, not reliable author attribution or a permanent global rename invariant. Avoid simultaneous edits when all versions must survive.

Labels-only changes have no dedicated server SSE notification. Another connected client discovers a remembered-only rename on its next deliberate label read. No fake task event or note approval is used to simulate label synchronization. A user may deliberately create the old name again in a later independent action; there is no permanent alias or redirect.
