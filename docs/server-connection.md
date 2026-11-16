# Connect to a server

- [Connect](#connect)
- [Local fallback](#local-fallback)
- [Reconnect and file safety](#reconnect-and-file-safety)
- [Home Assistant tasks](#home-assistant-tasks)

## Connect

For a server configured to use HA tasks, also read [Home Assistant tasks](#home-assistant-tasks).

Click the `[L]` button in the top-right corner, enter the server URL (e.g. `http://127.0.0.1:8080`), and click **Connect**. The badge changes to `[S]`. Click it again and choose **Use local files** to switch back and clear the saved URL.

## Local fallback

A resource GET that fails to establish a connection, validate TLS, resolve DNS, or finish within its 30-second deadline automatically selects local files. The app shows `Server unavailable; using local files`, the `[L]` badge, local tasks, the local note, and local label suggestions. It keeps the configured server URL and certificate preference. It never disables certificate validation automatically. HTTP errors such as 401 or 503, invalid response data, and an SSE-only outage do not switch stores.

Local files are the current data-directory contents, not a guaranteed fresh or per-server cache. Once initialized, local edits save locally and file watcher changes refresh both panes. Failed server mutations are never replayed locally. Unsaved note and task drafts remain available; transferring a draft to another destination requires an explicit choice. After a destination change, a retained add draft asks for another submission to confirm the new destination.

Actions pause during destination loading. Existing panes and drafts remain mounted. `Waiting for local storage` means an already-issued native file operation must settle before loading/enabling the new destination. A timeout never pretends that operation was canceled. Real local read or write failures stay visible.

## Reconnect and file safety

The whole-file task reconciliation described below applies to file-backed servers. HA tasks follow the authoritative-server policy in [Home Assistant tasks](#home-assistant-tasks).

Fallback lasts until app restart or explicit **Connect**, even if connectivity returns. Open settings and click **Connect** to retry the saved URL, including an unchanged URL. Merely closing settings or changing UI preferences does not reconnect. A repeated connection failure returns to local files after pending local writes settle.

Reconnect reads both note and task copies before applying either reconciliation result. Failed discovery performs no reconciliation writes. After discovery, the configured strategy still applies: `ask` requests a choice, `server` overwrites local copies, and `local` uploads local copies. An empty server note can intentionally replace a nonempty local note under `server`. A dirty editor draft still requires its separate destination choice before persistence.

Application is per-resource, not transactional. If one resource succeeds and the next fails, the connection status reports applied and uncertain outcomes and stops further automatic application. An uncertain result can already have committed. Click **Connect** to read actual state again; no old action is automatically replayed or rolled back. Earlier server backups already admitted to local storage may finish before fallback loading. They cannot overwrite local edits enabled afterward. There is no offline upload queue or automatic merge. See [live sync](live-sync.md) for approval and save ownership rules.

## Home Assistant tasks

Configure HA only on ntr server: URL, token file, list entity, and optional private CA certificate. Clients need only the ntr URL. See [server setup](../../server/docs/home-assistant.md).

Before reconnect writes, the client validates `/api/capabilities`. HA tasks always use the server copy regardless of conflict strategy; local task files and fallback edits are never uploaded to HA. Notes still follow the selected strategy. Raw task replacement is guarded on both sides. Only a 404 capability response selects older file-server compatibility; malformed responses and other errors stop initialization without reconciliation writes.

With ntr server 0.2.12 or later, every visible HA list is a project, including empty lists. Friendly names appear in selectors; duplicate names show entity IDs. Unselected creates go to the configured default list. HA list membership is not a `+project` summary token: existing literal tokens stay intact. Local/file-backed project editing is unchanged. Catalog-only updates refresh labels/routing and invalidate destructive confirmations, without accepting changed task content or discarding drafts.

Changing a task's list in Edit opens a separate move confirmation. ntr copies and verifies before deleting the source, preserving native description/status/due and task identity. Stop other HA writers during moves: HA has no atomic cross-list transaction. If a move fails, review both lists and the pending-move notice. Reconcile only repairs a proven-complete move; Abandon clears the block without deleting either copy. Neither action retries HA writes. Retained copies remain separate tasks.

Creating projects makes HA Local To-do lists only when the server administrator enables `HA_MANAGE_LISTS=true` with an admin token. Rename changes the HA entity display name, not its ID. Delete requires confirmation and a freshly empty list, including completed tasks; the default is protected and other providers cannot be deleted. Stop other writers during deletion. Never blindly retry an uncertain administrative action. The server's ntr API remains unauthenticated, so administrative opt-in requires a trusted connection or authenticating proxy. A catalog failure blocks routing instead of staging fake projects locally.

An HA outage is an ntr HTTP error, not a transport failure that triggers local fallback. An unavailable ntr server still activates the existing fallback. Reconnect never replays failed mutations; uncertain writes may already have committed. Reload actual state before another change. Existing task files are not automatically imported, merged, or deleted.
