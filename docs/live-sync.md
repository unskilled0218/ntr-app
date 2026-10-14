# Live sync

Clients connected to the same server receive task and note changes through `/api/events`. Each notification re-reads the affected resource. Closely spaced task and note changes refresh both panes independently. Local mode still uses the file watcher and requires no server.

A clean note adopts incoming text even while focused. Its selection stays at the same logical offsets, clamped when the new text is shorter. Unsaved edits that differ from incoming text open the existing Keep mine / Use theirs dialog. Empty incoming notes are valid conflicts. Updates received during saving or IME composition wait for safe reconciliation; pending remote reads block automatic saves rather than overwrite an unclassified update.

## Connection recovery

The native SSE bridge reconnects after failed connections, unsuccessful responses, stream errors, closure, or 60 seconds without incoming bytes. Retries start after one second and increase to a maximum of 30 seconds. A healthy stream resets the retry delay after 30 seconds. Connection establishment has a 15-second deadline; established streams have no total lifetime limit.

Every accepted connection refreshes tasks and notes, including changes missed while disconnected. Failed resource reads have a 30-second deadline and retry with a one-second initial delay and a 30-second cap. These retries stop when the pending refresh succeeds; they are not continuous polling. Disconnecting or replacing the connection cancels stream work and resource retry timers.

The server sends keep-alive comments every 15 seconds. Reverse proxies must forward them promptly and avoid buffering the SSE response. Otherwise clients can repeatedly hit the inactivity deadline despite a running server. Certificate validation remains enabled unless Allow self-signed certificates is explicitly selected.

Changing the server or local data directory invalidates old reads and queued side effects. Dirty note drafts stay available, but uploading an old draft to a different target requires a new explicit choice. Closing settings without changing the target does not transfer a draft to another server. Requests already accepted by their original destination cannot be recalled.

## Concurrent edits

Storage remains last-write-wins. This is live synchronization, not collaborative text merging or server-side version checking. A write already in flight can overwrite another client's concurrent note save. Conflict detection protects unsaved text that the client can observe; it cannot recover an overwritten server version. Avoid simultaneous edits to the same note when both versions must survive.

If a remote read keeps failing, the editor retains the draft and displays the error. Automatic saves remain blocked while a known incoming update cannot be classified. Restore connectivity or resolve an established conflict explicitly; restarting is not required for ordinary connection recovery.

## Verification

Run `npm test` and `npm run build` in `app/`, and `cargo test` plus `cargo clippy --all-targets` in `app/src-tauri/`. The native suite includes loopback SSE failures, cancellation, idle detection, and heartbeat tests. The regular suite does not require a running external server.

For the opt-in test with two independent native bridges and a real server restart, build the server, then run from `app/src-tauri/`:

```sh
MY_NTR_SERVER_BIN=/absolute/path/to/my-ntr-server cargo test two_clients_sync_and_recover_missed_files_after_real_server_restart -- --ignored
```

This check uses disposable files and a loopback port. It verifies bidirectional notifications, nearby task/note changes, and recovery of offline file edits without another mutation. It does not replace a two-window desktop/mobile check of focus, selection, IME, conflict choices, and reverse-proxy behavior.
