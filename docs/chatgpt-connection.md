# Connect a ChatGPT account

This guide describes the connection tool in the guided model connection branch.
Sign-in grants permission; it does not prove that a model request completed or
that quota is available. These commands perform no inference.

The flow follows OpenAI's [open-source sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [self-hosted VM guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).
It uses a public client, PKCE, a private loopback callback and signed ID-token
validation. It does not read your personal Codex credentials or require an API
key or client secret.

## On your own computer

Build the application, then run:

```sh
pnpm connect:chatgpt sign-in --same-computer
pnpm connect:chatgpt status
```

The browser and this command must run on the same computer. After browser
sign-in, the terminal shows the proposed account. Confirm it to save and select
it. Declining preserves the previous selection. No job starts automatically.

`status` returns account IDs, revisions, expiry and granted plan permission.
It never returns credentials. Two registrations can have the same email; use
their distinct IDs.

To sign in again, reuse the saved registration:

```sh
pnpm connect:chatgpt sign-in --same-computer --registration ACCOUNT_UUID
```

To explicitly enable plan permission after an identity-only sign-in, add
`--enable-plan`. Ordinary sign-in does not force another consent prompt.
`--manual-link` is available for a new registration when the local browser
cannot be opened. Returning authorization links contain a private ID-token hint
and are opened directly instead of printed.

## On a server or in a container

A phone or laptop browser cannot reach a callback bound to the server's
`127.0.0.1`. Prepare the server first and complete sign-in on your own computer.

On the server, as the installation's runtime owner:

```sh
pnpm connect:chatgpt prepare-target
```

For the repository's Compose installation:

```sh
docker compose exec --user node app node artifacts/api-server/start-chatgpt.mjs prepare-target
```

Keep the returned `targetHostId`. The server retains this stable identity when
importing; the laptop's host ID does not replace it.

On your own computer, complete sign-in and inspect `status`. Export exactly the
selected account at its observed revision:

```sh
pnpm connect:chatgpt export --registration ACCOUNT_UUID --expected-revision REVISION --target-host TARGET_HOST_URN --transfer-directory ABSOLUTE_NEW_DIRECTORY
```

The new directory's parent must already exist. Export protects the directory
and files for their owner before writing credentials. It retires the local
credential set before marking the transfer ready, without revoking the session
the server will use. A nearly expired session must be renewed by signing in
again before export.

Transfer the protected directory over SSH, preserving owner-only protection:
`0700` for the directory and `0600` for files on Unix; a protected owner/SYSTEM
ACL on Windows. Use the server runtime's OS user, not a different administrative
account. Never upload these files through the application, chat, email or Git.

Import on the server:

```sh
pnpm connect:chatgpt import --expected-revision 0 --transfer-directory ABSOLUTE_TRANSFER_DIRECTORY
```

For Compose, place the protected directory in a path mounted into `app`, then:

```sh
docker compose exec --user node app node artifacts/api-server/start-chatgpt.mjs import --expected-revision 0 --transfer-directory /app/data/TRANSFER_DIRECTORY
```

Revision `0` means a new account. For an existing signed-out registration, use
its current revision from `prepare-target`. A signed-in target is preserved.
The import validates the signed identity, saves the selected registration and
lets this server own subsequent token refreshes. Once connected, the web UI can
be used from the phone through your installation's authenticated remote access.

Successful import replaces its transfer file with a credential-free consumed
record. Check `transferFileCleared`; remove other transfer copies after success.
Export is ready for at most ten minutes, and credentials can expire earlier.
A `prepared` or `consuming` record after interruption is deliberately
unimportable: inspect status and sign in again instead of replaying it.

OpenAI currently documents that host-specific usage attribution and revocation
are unavailable for transferred sessions. See the linked VM guide for current
limits.

## Storage and sign-out

Installed PostgreSQL runtimes share encrypted registration storage and a durable
refresh lock. Development without PostgreSQL uses an encrypted owner-private
store at `~/.agentic-company-os-chatgpt`; an absolute
`CHATGPT_STORAGE_DIRECTORY` can select a different development directory.
The CLI's `--store-directory ABSOLUTE_PATH` explicitly selects a protected local
store, which is useful when preparing a laptop session for transfer.

Refresh replaces the complete rotating token set. Temporary failures preserve
valid credentials; confirmed unusable-token errors clear credentials and retain
the account/client mapping for sign-in again. A crashed local file lock is not
automatically stolen by a timeout. Stop every process using that local store
before an operator removes a stale `registration.lock`.

```sh
pnpm connect:chatgpt sign-out --registration ACCOUNT_UUID
```

Sign-out reports local clearing and remote revocation separately. If
`revocationConfirmed` is `false`, disconnect the application in
[ChatGPT settings](https://chatgpt.com/settings/usage). No refresh token means
that remote revocation is reported as `null`.

## Verified scope

Automated checks use signed synthetic identities, owned HTTP fixtures,
encrypted storage, actual Windows ACLs and an owned PostgreSQL 17.10 server.
They do not establish successful human sign-in, paid inference, a physical
phone session, or native macOS/Linux execution. Those results must be reported
separately when verified.
