# Telegram reminders for Digital To-Do

**Production site:** https://digital-todo.186-246-27-151.sslip.io/

**API:** `https://digital-todo.186-246-27-151.sslip.io/api/telegram/`

**Текущий статус:** серверные напоминания настроены в режиме общего webhook. Digital To-Do обрабатывает свои команды `/todo dt_<nonce>` и совместимые старые ссылки `/start dt_…`, а остальные Telegram updates передаёт прежнему приложению с сохранением исходного JSON и его успешного ответа. Прежний сервис продолжает работать; параллельный getUpdates не запускается. Адрес прежнего webhook и секреты хранятся только на сервере. Доставка напоминаний в личный чат пользователя ещё не подтверждена.

Пользователь **сам** открывает «Telegram-напоминания», нажимает «Подключить», переходит по одноразовой ссылке и отправляет подготовленную команду `/todo` с кодом привязки в личном Telegram-чате. Успешный getMe, регистрация общего webhook или готовый API не заменяют личную привязку и проверку реальной доставки.

There is no bot token in the browser, repository, or frontend build. Store it only in `/etc/digital-todo/assistant.env` on the VPS, outside the checkout and releases. Give the server administrator the token through a secure channel, not a public chat or commit.

## Production deployment

The systemd service is `digital-todo-assistant`. It runs one Node.js process and one Telegram scheduler from `/opt/digital-todo/current/server/index.mjs`. `/opt/digital-todo/repository` is the sparse checkout of GitHub `main`; `/opt/digital-todo/releases/<SHA>` contains releases, and `/opt/digital-todo/current` points to the active one.

`digital-todo-update.timer` checks GitHub every five minutes. The update script `/usr/local/sbin/digital-todo-update` (source: `deploy/update.sh`) tests the new release before switching `current`, restarts the service and restores the previous release if health fails. Secrets and `/var/lib/digital-todo/telegram-reminders.json` remain outside the releases and survive rollback.

The main domain and GitHub Pages mirror have separate browser storage: their local task lists and pairing credentials are independent. No automatic cross-domain or cross-device synchronization is implied.

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
CORS_ORIGIN=https://digital-todo.186-246-27-151.sslip.io,https://supremegoogle.github.io
```

Create `/var/lib/digital-todo` owned by the service account, mode `0700`; the module creates its JSON file atomically with mode `0600`. Keep the directory **outside the checkout** and mount it as persistent storage if using Docker. Without `REMINDERS_DB`, the default is `~/.digital-todo/telegram-reminders.json`. Backups also contain private chat mappings and must remain private. The stored browser credential is a SHA-256 hash, never the raw bearer token. The bot token is never written to this database.

In standalone polling mode, the bot must not have a webhook or another `getUpdates` consumer. For a bot already serving another application, use shared webhook mode below instead. Run **one instance** with one database writer. After setting the token, restart the service. `getMe` determines the real bot username; the browser does not guess it. If Telegram is unavailable on startup, pressing Connect retries initialization. No real Telegram messages are sent by the automated tests.

## Sharing a bot with an existing application

Set these server-only environment variables before switching Telegram's webhook:

```dotenv
TELEGRAM_WEBHOOK_SECRET=<new random Telegram webhook secret>
TELEGRAM_FORWARD_WEBHOOK_URL=<existing application's exact HTTPS webhook URL>
# Only if the existing webhook requires its own Telegram secret header:
TELEGRAM_FORWARD_WEBHOOK_SECRET=<existing application's secret>
```

The administrator sets Telegram's webhook URL to this service's `/api/telegram/webhook` endpoint and uses the same `TELEGRAM_WEBHOOK_SECRET` as Telegram's `secret_token`. Keep the previous webhook URL and rollback configuration private. Do not drop pending updates or change the previous application's update-type subscriptions without deciding how to preserve them.

With `TELEGRAM_WEBHOOK_SECRET` set, this service never calls `getUpdates`; startup only identifies the bot and starts the reminder scheduler. Requests to the webhook must carry the matching `X-Telegram-Bot-Api-Secret-Token`, checked with a timing-safe comparison. The webhook body limit is 64 KiB.

New To-Do links prefill `/todo dt_<one-time nonce>` using Telegram’s `text` parameter. The user sends the draft; only our namespaced commands and compatible legacy start links are intercepted, including expired or consumed links. **All other update payloads** (ordinary messages even from a connected chat, another application's start links, edited messages, callbacks, and unknown update types) are forwarded to the old HTTPS webhook as the original JSON body. The new incoming secret is not leaked downstream; an old secret is attached only through the optional forwarding variable. Successful legacy Bot API response bodies are returned to Telegram too, preserving applications that reply directly from their webhook.

A successful forward returns HTTP 200. A non-success response, timeout, or unavailable destination returns HTTP 503 so Telegram can retry; events are not acknowledged and silently discarded. Forwarded retries remain the previous application's responsibility to deduplicate by `update_id`. In standalone polling mode only, existing unprefixed 43-character To-Do pairing links remain accepted.

## Frontend integration

Load `css/reminders.css`, import `initReminders` from `js/reminders.js`, and call it after the page is ready. By default it adds **Telegram-напоминания** inside the existing `.board-actions-menu` (fallback: `.toolbar-right`); pass `{mount: element}` to choose another location. It does not add a floating button or change the topbar grid.

The API base is derived from the existing `assistant-endpoint` meta value by replacing `/assistant` with `/telegram`. The production value is `https://digital-todo.186-246-27-151.sslip.io/api/telegram`. An explicit public, non-secret override is `<meta name="telegram-endpoint" content="https://digital-todo.186-246-27-151.sslip.io/api/telegram">`. HTTPS is required except localhost. Local development defaults to port 8787 when no production endpoint is set.

## User flow and behavior

1. Open Reminders, press Connect, follow the generated Telegram link and send the prefilled `/todo dt_<nonce>` command. The one-time pairing nonce expires after five minutes and only works in a private chat.
2. Return to the site, choose individual active tasks and exact local reminder dates/times, then press Save. Only selected task IDs, titles, and timestamps are sent. Notes and the rest of the task list stay in the browser.
3. While the site is open, completing or deleting a task cancels its reminder after a one-second debounce. Renaming a selected task updates the saved title. At next startup the browser also synchronizes its previous explicit selection.
4. Reminders continue on the server when the browser is closed. **Changes made offline or in a different browser cannot cancel a server reminder until this browser reconnects and synchronizes.** The main task database remains local to the browser; there is no cross-device task sync.
5. Disconnect revokes the browser credential and deletes all its stored reminders. Clearing browser storage loses the local credential; the owner can remove an orphaned session from the private database while the service is stopped.

For a real delivery check, the user must pair their own private chat, select a demonstration task and a future reminder time, save it, and actually receive the message. Until then, report the status as configured/linked separately from delivered. Do not claim a message was delivered based only on automated tests or server health.

The scheduler checks every 15 seconds. Each reminder has **at most one delivery attempt**, persisted before calling Telegram, so a process restart cannot duplicate it. A timeout or delivery failure is recorded as `failed` (or `sending` if the process crashed); it is not retried automatically because a timeout may already have delivered a message. The settings report failed attempts; select a new future time to try again. This is not an exactly-once delivery guarantee.

Limits: 40 reminders per browser session, maximum 366 days ahead, five pairing requests/minute/IP, 80 other requests/minute/IP, 24 KB request body, 1,000 linked/pending sessions. For a public high-traffic deployment, add HTTPS reverse proxy controls and monitoring. Do not run multiple independent instances with the same file.

## Tests

Calendar export is a separate browser feature: «Календарь → В календарь телефона» downloads an `.ics` snapshot of active dated tasks matching the current search and tag. Events are all-day; task notes are excluded. Importing this file does not subscribe the phone calendar to later task changes and is independent of Telegram pairing.

```sh
node --test server/telegram.test.mjs
```

Tests use an injected fake Telegram transport and a temporary private database. They check disabled mode, one-time pairing, expired/group rejection, hashed credentials, isolation, delivery once across restart, cancellation snapshots, and disconnect.

## Ссылка с командой /todo

Новые ссылки открывают личный чат с подготовленным текстом `/todo dt_<одноразовый код>` через параметр `text`, без `start=`. Telegram требует, чтобы пользователь сам нажал «Отправить». Код связывает именно этот браузер с личным чатом и действует пять минут. В настройках есть копирование команды для клиентов, которые не подставляют черновик. Простая `/todo` посторонних пользователей по-прежнему передаётся прежнему приложению.

Ответ об активации возвращается непосредственно в webhook-ответе Telegram, без дополнительного исходящего запроса с VPS. Запланированные напоминания отправляются сервером отдельно. После сохранения на сайте появляется подтверждение создания; оно подтверждает запись расписания, а не факт доставки сообщения.
