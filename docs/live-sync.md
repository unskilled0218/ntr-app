# Live sync

- [Connection recovery](#connection-recovery)
- [Update choices](#update-choices)
- [Note save ownership](#note-save-ownership)
- [Concurrent edits](#concurrent-edits)
- [Verification](#verification)

Clients connected to the same server receive task and note change signals through `/api/events`. Signals and reconnects detect changes without applying them. Each resource has one accepted snapshot and one coalesced pending update. Detection reads neither paint content nor write backups. Local mode still uses the file watcher and applies local file changes without a server approval prompt.

A notification asks “Tasks changed elsewhere. Update now?” or the corresponding note question using the same dialog surface as project selectors. It previews saved accepted content against the exact incoming snapshot, never against unsaved editor text. Nothing changes in either pane until approval. Empty notes, deleted tasks, and reassigned task IDs count as changes.

## Update choices

**Update** revalidates the identified snapshot. A newer version needs another choice; a failed read or application retains the question with retry. Clean notes adopt approved text through the editor's normal write path, preserving logical selection offsets. Dirty notes require a second explicit Keep mine / Use theirs choice. Saves and IME composition can defer application without acknowledging success.

The read-only Diff view uses −/+ markers for removed/added text and = for unchanged context. Notes show line changes, collapsed long unchanged runs, and trailing-newline differences. Tasks match stable IDs and include raw text, completion state, and creation/completion dates; reassigned IDs appear as removed/added tasks rather than guessed renames. Order alone does not change task approval identity. Accepted and Incoming views inspect either complete snapshot through bounded pages; note markup remains escaped text, not rendered HTML or Markdown.

Previous changes and Next changes replace the current page rather than accumulating content. Every view limits content to 8,000 characters and 80 newline boundaries per page; long lines can continue on the next page. Location and remaining-character labels disclose continuation. Notes exceeding 50,000 combined input characters or a 40,000-cell line-comparison budget use paged accepted/incoming blocks instead of an unrestricted diff. Approval controls remain available while inspecting pages. A newer offer resets inspection; an own successful write rebuilds the baseline evidence without resurfacing an unchanged declined remote version. Old preview choices/tokens cannot approve replacement evidence.

**Not now**, Escape, and backdrop dismissal leave content and drafts unchanged and never upload the local version. The same declined content does not reopen automatically. A persistent **Review update** action, also available on mobile, rechecks and reopens that version without another event or restart. A verified convergence read clears pending state. Task and note questions queue instead of stacking over settings or version-choice dialogs.

While a note update is pending, the note shows “Remote update pending; automatic saving paused”. Input, autosave, blur, and pagehide cannot overwrite that remote version. Review first offers the remote update; replacing a dirty draft requires Use theirs, and only explicit Keep mine authorizes an overwrite. Dismissing that version-choice dialog also stays read-only for runtime remote updates.

Project filtering and sorting use the accepted unfiltered task snapshot. Own task mutations apply only their returned task or targeted deletion, not an unrelated remote list. Unsafe edit, complete, delete, and project-removal actions reopen review rather than sending stale IDs. Reviewing can suspend a task edit dialog without discarding its fields; **Resume task draft** restores it. A changed task cannot be saved through that old action: copy the draft and choose Edit against the new task identity. Actions are never replayed automatically.

[Project renaming](project-renaming.md) and project removal wait for fresh task validation between writes, including slow own-write rescans. Foreign divergence stops further stale-ID writes. A paused rename can yield its modal to Review update without losing progress, but approval does not retry it. Renames finalize remembered labels separately, keep pending note approval independent, and expose partial completion and explicit retry rather than promising a multi-resource transaction. Labels-only renames have no dedicated SSE token; other clients discover them on a deliberate label read.

Pencil/trash actions in filter and create-task project selectors share these global safeguards. Staged-only choices stay draft-local unless a same-destination retained operation owns the name. Both rename and removal results reopen through related row icons or an in-selector fallback; opening a result is read-only. Partial removal retains its source guard and task/label progress until verified completion or explicit abandonment. Another destination keeps separate stopped records and cannot acquire their write authority. Create-task rename retains its originating picker and compact Task options underneath; Review update explicitly closes that entire stack before approval. Other replacement actions keep their existing close-first behavior.

The app supplies one random session ID in the optional `X-Ntr-Client-Id` mutation and SSE headers. Server `0.2.9` or later filters that subscriber's own events; watcher changes and other clients still notify. The header is advisory, not authentication. Older servers retain the approval boundary and equal-content echo suppression, but cannot provide precise author attribution. Differing content is never discarded as a presumed self-event.

## Connection recovery

The native SSE bridge reconnects after failed connections, unsuccessful responses, stream errors, closure, or 60 seconds without incoming bytes. Retries start after one second and increase to a maximum of 30 seconds. A healthy stream resets the retry delay after 30 seconds. Connection establishment has a 15-second deadline; established streams have no total lifetime limit.

Every accepted connection detects tasks and notes, including changes missed while disconnected, without adopting them. Failed detection reads retain visible content and report a retryable error. Resource GETs have a 30-second deadline and recovery retries start at one second with a 30-second cap. These retries stop after successful detection; they are not continuous polling. Replacing the connection cancels obsolete stream work, resource retries, and approval tokens while retaining same-destination accepted and deferred snapshots.

If the server broadcast buffer overflows, it emits both existing `tasks` and `note` tokens before resuming retained events. These rescan signals bypass origin filtering, so lost foreign changes remain detectable even when all retained events are self-events. Equal-content rescans do not prompt. Legacy clients can parse the same tokens but may automatically refresh both panes after lag.

The server sends keep-alive comments every 15 seconds. Reverse proxies must forward them promptly and avoid buffering the SSE response. Otherwise clients can repeatedly hit the inactivity deadline despite a running server. Certificate validation remains enabled unless Allow self-signed certificates is explicitly selected.

First initialization and genuine destination changes retain the configured startup reconciliation strategy (`ask`, `server`, or `local`). Closing unchanged settings does not reload panes, replace the subscription, or reconcile files. UI-only settings apply independently. Certificate-policy changes for the same URL replace the transport and detect changes, but do not repeat startup reconciliation or accept a declined snapshot under any strategy. Destination identity is the server URL, or the local data-directory generation in local mode.

Changing the destination invalidates old reads and queued side effects. Dirty note drafts stay available, but uploading an old draft to a different target requires a new explicit choice. Requests already accepted by their original destination cannot be recalled.

## Note save ownership

Each mounted note pane allows only one outstanding save per destination, including saves started on pagehide. Closing settings without changing the server, changing certificate policy for that URL, or switching away and back does not release a pending save's slot. Another server URL or local data-directory generation has its own slot; moving a draft there still requires the existing explicit conflict choice.

If settings invalidate a save's view while its PUT is pending, the pane waits for settlement and detects the current note before another automatic save. The obsolete completion cannot mark newer input as saved or paint over a draft. Successful writes advance only known local content in the coordinator; failed or uncertain writes retain the previous accepted snapshot. Events received during writes remain pending evidence. Mutation epochs and per-resource read generations prevent older GETs and prepared applications from rolling back a newer write.

Newer undo and input remain protected even when they restore the pre-save baseline, including an empty note. Returning to that text is an editing choice, not proof that the editor stayed untouched. The pane tracks committed editing separately from the saved text, retaining that evidence through PUT settlement, pending recovery reads, retries, and repeated settings activations. This also covers edits made while the recovery GET is pending and committed IME input.

If recovery finds differing text, notification approval precedes the version-choice dialog, which preserves newer baseline-return drafts. Keep mine writes the current draft, including empty text; Use theirs adopts the approved version. Only synchronous token validation, pane application, and acknowledgment advance accepted remote content. Failed, canceled, draft-blocked, and IME-deferred applications remain unresolved. A rejected PUT response does not prove that storage stayed unchanged.

A request that never settles keeps its destination blocked; a timer does not free ownership while that write could still reach storage. Ownership is local to the mounted pane, not a lock across separate clients, remounted panes, or different URLs that happen to share storage.

## Concurrent edits

Storage remains last-write-wins. This is change detection with explicit approval, not collaborative merging, persistent revision history, or transactional compare-and-swap. A write already in flight can overwrite another client's concurrent save; a validated task action can still race another write. Detection protects observed drafts and snapshots, but cannot recover overwritten server versions or detect changes while disconnected. Avoid simultaneous edits when both versions must survive.

If a remote read keeps failing, the editor retains the draft and displays the error. Automatic saves remain blocked while a known incoming update cannot be classified. Restore connectivity or resolve an established conflict explicitly; restarting is not required for ordinary connection recovery.

## Verification

Run `npm test` and `npm run build` in `app/`, and `cargo test` plus `cargo clippy --all-targets` in `app/src-tauri/`. The native suite includes loopback SSE failures, cancellation, idle detection, and heartbeat tests. The regular suite does not require a running external server.

Coordinator and real-pane tests cover unchanged settings under every startup strategy, same-destination transport replacement, deferred review, pending-note save guards, task draft suspension, stale IDs, reconnect recovery, epoch-invalidated GETs, uncertain writes, equal-content rescan suppression, and concurrent foreign changes during PUTs. Existing note regressions retain IME, undo, empty-draft, destination, and single-flight ownership coverage. Run focused approval checks with `npm test -- src/lib/remoteUpdates.test.ts src/remoteApproval.test.tsx src/liveSync.test.tsx`.

For the opt-in test with two independent native bridges and a real server restart, build the server, then run from `app/src-tauri/`:

```sh
MY_NTR_SERVER_BIN=/absolute/path/to/my-ntr-server cargo test two_clients_sync_and_recover_missed_files_after_real_server_restart -- --ignored
```

This check uses disposable files and a loopback port. It verifies bidirectional notifications, nearby task/note changes, and recovery of offline file edits without another mutation. It does not replace a two-window desktop/mobile check of focus, selection, IME, conflict choices, and reverse-proxy behavior.
