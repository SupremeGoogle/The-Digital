# Telegram reminders for Digital To-Do

The interface is implemented but Telegram is **off until a real bot token is configured on the server**. There is no token in the browser, repository, or frontend build. Give the server administrator the token through a secure channel, not a chat or commit.

## Server integration

The repository already wires this module into `server/index.mjs`, including startup and shutdown hooks. The snippet below documents the wiring; do not add it a second time. With the systemd configuration in `CLAUDE-DEPLOY-ASSISTANT.md`, `StateDirectory=digital-todo` supplies the writable private directory despite `ProtectSystem=strict`.

```js
import { createTelegramService } from './telegram.mjs';
const telegram = createTelegramService(env);
// Inside the existing HTTP handler, AFTER the origin check, BEFORE assistant routing:
if (await telegram.handle(req, res)) return;
// After server starts listening:
void telegram.start();
server.on('close', () => telegram.close());
```

The parent HTTP server must allow the exact website origin and permit `Authorization, Content-Type` headers for Telegram preflight requests. Do not put this handler before the global origin check. The module handles only `/api/telegram/*` and returns `false` for unrelated URLs.

Environment, to be added by the server administrator (including Claude Code when operating on that server):

```dotenv
TELEGRAM_BOT_TOKEN=<server-only value supplied by the owner>
REMINDERS_DB=/var/lib/digital-todo/telegram-reminders.json
CORS_ORIGIN=https://supremegoogle.github.io
```

Create `/var/lib/digital-todo` owned by the service account, mode `0700`; the module creates its JSON file atomically with mode `0600`. Keep the directory **outside the checkout** and mount it as persistent storage if using Docker. Without `REMINDERS_DB`, the default is `~/.digital-todo/telegram-reminders.json`. Backups also contain private chat mappings and must remain private. The stored browser credential is a SHA-256 hash, never the raw bearer token. The bot token is never written to this database.

The bot must not have a webhook or another `getUpdates` consumer. This service uses Telegram long polling and should run in **one instance** with one database writer. After setting the token, restart the service. `getMe` determines the real bot username; the browser does not guess it. If Telegram is unavailable on startup, pressing Connect retries initialization. No real Telegram messages are sent by the automated tests.

## Frontend integration

Load `css/reminders.css`, import `initReminders` from `js/reminders.js`, and call it after the page is ready. By default it adds **Telegram-напоминания** inside the existing `.board-actions-menu` (fallback: `.toolbar-right`); pass `{mount: element}` to choose another location. It does not add a floating button or change the topbar grid.

The API base is derived from the existing `assistant-endpoint` meta value by replacing `/assistant` with `/telegram`. For another location, set a public, non-secret `<meta name="telegram-endpoint" content="https://your-server.example/api/telegram">`. HTTPS is required except localhost. Local development defaults to port 8787.

## User flow and behavior

1. Open Reminders, press Connect, follow the generated Telegram link and press Start. The one-time pairing nonce expires after five minutes and only works in a private chat.
2. Return to the site, choose individual active tasks and exact local reminder dates/times, then press Save. Only selected task IDs, titles, and timestamps are sent. Notes and the rest of the task list stay in the browser.
3. While the site is open, completing or deleting a task cancels its reminder after a one-second debounce. Renaming a selected task updates the saved title. At next startup the browser also synchronizes its previous explicit selection.
4. Reminders continue on the server when the browser is closed. **Changes made offline or in a different browser cannot cancel a server reminder until this browser reconnects and synchronizes.** The main task database remains local to the browser; there is no cross-device task sync.
5. Disconnect revokes the browser credential and deletes all its stored reminders. Clearing browser storage loses the local credential; the owner can remove an orphaned session from the private database while the service is stopped.

The scheduler checks every 15 seconds. Each reminder has **at most one delivery attempt**, persisted before calling Telegram, so a process restart cannot duplicate it. A timeout or delivery failure is recorded as `failed` (or `sending` if the process crashed); it is not retried automatically because a timeout may already have delivered a message. The settings report failed attempts; select a new future time to try again. This is not an exactly-once delivery guarantee.

Limits: 40 reminders per browser session, maximum 366 days ahead, five pairing requests/minute/IP, 80 other requests/minute/IP, 24 KB request body, 1,000 linked/pending sessions. For a public high-traffic deployment, add HTTPS reverse proxy controls and monitoring. Do not run multiple independent instances with the same file.

## Tests

```sh
node --test server/telegram.test.mjs
```

Tests use an injected fake Telegram transport and a temporary private database. They check disabled mode, one-time pairing, expired/group rejection, hashed credentials, isolation, delivery once across restart, cancellation snapshots, and disconnect.
