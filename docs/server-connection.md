# Connect to a server

- [Connect](#connect)
- [Local fallback](#local-fallback)
- [Reconnect and file safety](#reconnect-and-file-safety)
- [Home Assistant tasks](#home-assistant-tasks)

## Connect

Open `[L]`, enter the ntr URL, and choose **Connect**. `[S]` indicates server mode. **Use local files** returns to local storage and clears the saved URL. Keep certificate checks enabled; allow self-signed certificates only as an explicit trust decision.

## Local fallback

A resource GET connection, DNS, TLS, or 30-second timeout failure selects local storage while keeping server settings. HTTP errors, malformed data, and SSE-only outages do not switch stores. Failed mutations are never replayed locally.

Fallback uses current local data, not a fresh or per-server cache. Drafts remain available, but moving one to another destination requires an explicit choice. Actions pause until destination loading and already-issued local writes settle. `Waiting for local storage` never means a write was canceled.

## Reconnect and file safety

Choose **Connect** or restart to retry the server; closing settings is not a retry. Both resources are discovered before reconciliation writes. Notes and file-backed tasks follow the selected `ask`, `server`, or `local` strategy; server strategy can deliberately adopt an empty note. A dirty draft still needs its own destination choice.

Reconciliation is per-resource, not a transaction. Partial/uncertain outcomes remain visible. Read actual state again before deciding what to do; no automatic rollback, merge, offline upload queue, or mutation replay exists. [Live sync](live-sync.md) explains runtime approval and save ownership.

## Home Assistant tasks

Configure HA on [ntr server](../../server/docs/home-assistant.md), not the client. Validated `/api/capabilities` makes HA tasks authoritative regardless of the reconciliation strategy. Local/fallback task edits never upload to HA; notes retain their chosen strategy. Only capability HTTP 404 selects older-server compatibility. Other errors block initialization without reconciliation writes.

Every visible HA list appears in selectors, including empty lists. Selectors use names and disambiguate duplicates with entity IDs. Unselected creates use the default. List membership is separate from literal summary labels. Catalog refresh changes routing/display metadata and invalidates destructive confirmations, not task acceptance or drafts.

Changing lists in Edit requires move confirmation. Stop other HA writers: copy/verify/delete is not atomic. An uncertain move needs inspection of both lists and explicit **Reconcile** or **Abandon**. Reconcile repairs only proven completion; abandon retains copies with separate identities. Neither repeats HA writes.

List administration requires `HA_MANAGE_LISTS=true` and an admin token. Rename changes display names; deletion requires a freshly empty Local To-do list, including completed tasks, and cannot delete the default. Stop other writers during deletion. Use trusted access or an authenticating proxy because ntr has no API authentication. Do not retry uncertain administration blindly. Catalog failures block routing rather than stage fake lists.

An HA outage returns an ntr HTTP error; it does not itself trigger local fallback. An unreachable ntr server does. Existing data is not automatically imported, merged, or deleted.
