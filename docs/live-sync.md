# Live sync

- [Update choices](#update-choices)
- [Connection recovery](#connection-recovery)
- [Local fallback](#local-fallback)
- [Note save ownership](#note-save-ownership)
- [Concurrent edits](#concurrent-edits)
- [Verification](#verification)

Server events detect task/note changes without applying them. Each resource keeps an accepted snapshot and one pending offer. Local mode instead applies local watcher changes directly.

## Update choices

**Update** revalidates the exact offered snapshot. Newer evidence requires another choice; errors retain the preview and offer **Retry update**. **Not now**, Escape, or backdrop dismissal changes nothing. **Review update** reopens declined evidence without another event.

The diff compares saved accepted content, not unsaved editor text. Task identity includes IDs and content; order alone does not require approval. Large diffs are paged and note content stays escaped text. Each page is limited to 8,000 characters and 80 newline boundaries; notes beyond 50,000 combined characters or 40,000 comparison cells use paged blocks.

Pending note updates pause autosave, blur, and pagehide writes. Dirty notes require **Keep mine / Use theirs** after update approval. Dismissing that choice does not authorize an overwrite. IME and outstanding saves can defer application without acknowledging success.

Task filters/sorts use accepted content. Own writes apply only their returned task or targeted deletion. Stale IDs require review, not replay. Review can suspend an edit draft; **Resume task draft** restores it, but a changed task needs a new Edit action. [Project operations](project-renaming.md) retain separate partial progress and explicit retry.

## Connection recovery

The native event stream reconnects after errors, closure, or 60 seconds without bytes. Handshakes have a 15-second deadline; retries back off from one to 30 seconds. A healthy stream resets backoff after 30 seconds. Resource GETs have a 30-second deadline and bounded one-to-30-second retry delays until detection succeeds.

Reconnect detects both resources, including missed changes, without accepting them. Overflow emits both resource signals and bypasses self-origin filtering. Keep-alive comments arrive every 15 seconds; proxies must forward them without buffering.

Unchanged settings do not reconcile again. Changing certificate policy at the same URL replaces the transport, not approval state. A new destination invalidates old reads/tokens. Issued requests cannot be recalled, and an old dirty draft needs explicit approval before saving elsewhere.

## Local fallback

Resource connection failures select local storage and retain server settings; HTTP errors and SSE-only failures do not. Already-admitted native backups/writes settle before local edits are enabled. Obsolete server completions cannot admit new backups afterward. A never-settling local operation keeps initialization blocked.

Only **Connect** or restart retries the server. See [connection safety](server-connection.md) for reconciliation, cache limits, and HA authority.

## Note save ownership

One outstanding save is allowed per destination in the mounted pane. Switching away and back does not free that slot. A changed view waits for settlement and recovery reads before another automatic save; old completions cannot overwrite newer drafts or mark them saved.

Undo, empty drafts, baseline-return input, and committed IME remain edits even while recovery is pending. Differing recovery text still needs update approval and **Keep mine / Use theirs**. Failed or deferred application remains unresolved. A rejected response does not prove that a write failed; a timer never releases ownership while it might commit.

## Concurrent edits

Storage is last-write-wins, not collaborative merge, revision history, or compare-and-swap. An in-flight write can overwrite concurrent content. Avoid simultaneous edits when both versions must survive. Pending read errors preserve drafts and block unsafe autosaves.

Session `X-Ntr-Client-Id` headers filter only proven own events, not external changes. They are advisory, not authentication. Equal-content rescans do not prompt; differing content is not discarded as a presumed echo.

## Verification

See [development checks](development.md#checks). The opt-in restart test uses a built loopback server:

```sh
MY_NTR_SERVER_BIN=/absolute/path/to/my-ntr-server cargo test --locked two_clients_sync_and_recover_missed_files_after_real_server_restart -- --ignored
```

Run it from `src-tauri/`. It does not replace real-device/window checks of focus, IME, selection, or proxy behavior.
