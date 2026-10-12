# Publish a Forgejo release

Run commands from the app repository root.

The release command requires a clean `main` checkout. It pushes `main`, runs the tests, builds missing requested artifacts, creates the `v<version>` Git tag and Forgejo release for `ntr/ntr-app`, and uploads each artifact with a SHA-256 file. Existing artifacts under `release/<version>/<target>/` are reused, so a completed build is not repeated. With no target argument it publishes both desktop and Android artifacts.

Create an access token in Forgejo under **Settings -> Applications -> Access Tokens** with repository-write permission. Store it outside the repository in a user-only file:

```sh
install -d -m 700 "$HOME/.config/forgejo"
umask 077
read -rsp "Forgejo token: " token
printf '%s' "$token" > "$HOME/.config/forgejo/forgejo-token"
unset token
stat -c '%a %n' "$HOME/.config/forgejo/forgejo-token"
```

The token file should have mode `600`. Do not store the token in this repository, shell history, or a project `.env` file. Inject it only for the release process:

```sh
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" scripts/release.sh
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" scripts/release.sh desktop
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" scripts/release.sh android
```

Set `FORGEJO_API_URL` only when publishing to a different Forgejo repository API endpoint. The script uses curl's normal certificate verification, checks repository API access before pushing a new tag, and can resume an interrupted release when the existing version tag points to an ancestor of `main`. The token needs repository-write permission; it does not need the `read:user` scope.
