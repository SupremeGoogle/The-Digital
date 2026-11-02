# Digital To-Do: сервер, обновление и подключение Диди

Этот документ описывает production-контур проекта и служит заданием для Claude Code при дальнейшей настройке. Секреты и реквизиты SSH здесь не сохраняются.

## Адреса и состояние

| Назначение | Адрес |
| --- | --- |
| Основной сайт | https://digital-todo.186-246-27-151.sslip.io/ |
| AI API | https://digital-todo.186-246-27-151.sslip.io/api/assistant |
| Состояние процесса | https://digital-todo.186-246-27-151.sslip.io/health |
| Telegram API | https://digital-todo.186-246-27-151.sslip.io/api/telegram/ |
| Общий Telegram webhook | https://digital-todo.186-246-27-151.sslip.io/api/telegram/webhook |
| Зеркало интерфейса | https://supremegoogle.github.io/The-Digital/ |
| Репозиторий | https://github.com/SupremeGoogle/The-Digital |

Провайдер — **RouterAI**, база `https://routerai.ru/api/v1`, модель production — **`openai/gpt-4.1-mini`**. В локальных экспериментах использовались и другие модели; исторический QA-отчёт не определяет текущую настройку VPS.

HTTPS сайта и настоящий потоковый AI-ответ проверены в браузере. Telegram настроен в режиме общего webhook с существующим приложением: Digital To-Do обрабатывает свои `/todo dt_<nonce>` (старые ссылки `/start dt_…` совместимы), а остальные updates пересылает прежнему обработчику вместе с его успешным ответом. Старое приложение продолжает работать; конкурирующий getUpdates не запускается. Прежний URL и секреты остаются только в env на сервере. Для напоминаний пользователь сам связывает личный чат кнопкой на сайте и отправляет подготовленную команду `/todo` с кодом привязки в Telegram. Доставка в его личный чат ещё не подтверждена.

## Где находится приложение

```text
/opt/digital-todo/
  repository/              sparse checkout origin/main
  releases/<COMMIT_SHA>/   отдельный релиз со статикой, API и тестами
  current -> releases/...  активный релиз для Nginx и Node.js
/etc/digital-todo/assistant.env
/var/lib/digital-todo/telegram-reminders.json
/usr/local/sbin/digital-todo-update
```

`repository` — рабочий checkout для получения исходников. `current` — символическая ссылка, а не Git-репозиторий: редактировать приложение непосредственно в нём не следует. Изменения делаются в исходном репозитории и попадают на сервер через `main`.

Секретный env-файл находится **вне checkout и релизов**, принадлежит root и имеет права `600`; каталог `/etc/digital-todo` — `700`. Telegram-база принадлежит служебному пользователю, каталог — `700`, файл — `600`. Она сохраняется при переключении и откате релизов. Резервные копии этой базы тоже приватны.

## Службы

| Компонент | Назначение |
| --- | --- |
| `digital-todo-assistant.service` | Node.js API и один Telegram-планировщик |
| `digital-todo-update.service` | Однократная проверка новой версии и deployment |
| `digital-todo-update.timer` | Проверка GitHub каждые 5 минут, с небольшим случайным сдвигом |
| Nginx | Статика из `current`, TLS и reverse proxy на localhost:8787 |

Исходные конфигурации находятся в `deploy/`: `digital-todo-assistant.service`, `digital-todo-update.service`, `digital-todo-update.timer`, `nginx.conf`, `update.sh`. На сервере `update.sh` устанавливается root-владельцем как `/usr/local/sbin/digital-todo-update`.

API запускается от непривилегированного пользователя `digital-todo`:

```ini
WorkingDirectory=/opt/digital-todo/current
EnvironmentFile=/etc/digital-todo/assistant.env
ExecStart=/usr/bin/node server/index.mjs
```

Используются `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp` и `StateDirectory=digital-todo`. Последний создаёт разрешённое место записи `/var/lib/digital-todo`, не открывая запись в релиз. Node.js слушает только `127.0.0.1:8787`; порт не должен быть доступен извне.

## Серверное окружение

Ниже — структура env-файла, **не действующие секреты**:

```dotenv
HOST=127.0.0.1
PORT=8787
CORS_ORIGIN=https://digital-todo.186-246-27-151.sslip.io,https://supremegoogle.github.io
AI_BASE_URL=https://routerai.ru/api/v1
AI_MODEL=openai/gpt-4.1-mini
AI_API_KEY=ENTER_REAL_KEY_ON_SERVER_ONLY
TELEGRAM_BOT_TOKEN=ENTER_SEPARATE_OR_APPROVED_BOT_TOKEN_ON_SERVER_ONLY
TELEGRAM_WEBHOOK_SECRET=GENERATE_RANDOM_SECRET_ON_SERVER_ONLY
TELEGRAM_FORWARD_WEBHOOK_URL=ENTER_EXISTING_PRIVATE_HTTPS_WEBHOOK_ON_SERVER_ONLY
# Заполнить только если прежний обработчик требует свой секретный заголовок:
TELEGRAM_FORWARD_WEBHOOK_SECRET=
REMINDERS_DB=/var/lib/digital-todo/telegram-reminders.json
MAX_REQUESTS_PER_MINUTE=8
MAX_DAILY_REQUESTS=200
TRUST_PROXY=true
```

В production используются общий бот и webhook. `TELEGRAM_WEBHOOK_SECRET` должен совпадать с `secret_token`, установленным при регистрации нового общего webhook. Прежний адрес хранится в `TELEGRAM_FORWARD_WEBHOOK_URL`; если старое приложение требует свой заголовок, его значение хранится отдельно в `TELEGRAM_FORWARD_WEBHOOK_SECRET`. Ни адрес с приватными параметрами, ни секреты не публикуются. Не запускать getUpdates параллельно webhook и не отключать пересылку прежнему приложению.

`CORS_ORIGIN` содержит точные origin, без завершающего слеша и без `/The-Digital/`. Для локальной проверки разрешённый localhost добавляется отдельно. `TRUST_PROXY=true` применим только потому, что Nginx перезаписывает X-Forwarded-For адресом клиента; при прямом доступе к Node использовать `false`.

Заполнять ключи через защищённый редактор/хранилище на сервере. Не выводить содержимое env-файла, `env`/`printenv`, заголовки Authorization, токены или SSH-ключи в чат, Git или логи. Не включать shell tracing `set -x`. В браузере ключей быть не должно.

## HTTPS и настройка фронтенда

`deploy/nginx.conf` обслуживает только публичные маршруты интерфейса: `/`, `/index.html`, `/favicon.svg`, CSS и JS. Остальные файлы, включая `/server/`, Git и env, не публикуются. Сертификат обслуживается штатным механизмом Let's Encrypt; не отключать проверку TLS.

Маршруты `/api/assistant`, `/api/telegram/*` и `/health` проксируются на `127.0.0.1:8787`. Для AI отключена буферизация (`proxy_buffering off`, `proxy_cache off`), чтобы браузер получал текст по мере генерации. Таймаут reverse proxy — 25 секунд, лимит тела — 48 КБ. HTTP перенаправляется на HTTPS.

В `index.html` используется публичная настройка:

```html
<meta name="assistant-endpoint" content="https://digital-todo.186-246-27-151.sslip.io/api/assistant">
```

Telegram-модуль получает `/api/telegram` из того же адреса. Зеркало GitHub Pages обращается к API на VPS; ключ в метатеге не нужен. Если метатег пуст, на опубликованном сайте работают локальные ответы, а localhost может найти сервер разработки на порту 8787.

Общий `/api/telegram/webhook` принимает обновления только с правильным секретным заголовком Telegram. Перехватываются только To-Do ссылки с префиксом `dt_`; обычные сообщения, чужие start-ссылки и callback queries остаются прежнему приложению. При ошибке пересылки возвращается 503 для повторной доставки Telegram, а не ложный успешный ответ.

Экспорт «Календарь → В календарь телефона» выполняется целиком в браузере через `js/calendar-export.js`. В `.ics` попадают активные задачи со сроками и текущими фильтрами поиска/метки. Это события на весь день и снимок на момент скачивания, без автосинхронизации; заметки не экспортируются. Сервер и Telegram-привязка для экспорта не нужны.

## Как происходит обновление

Таймер запускает `/usr/local/sbin/digital-todo-update`, установленный из `deploy/update.sh`:

1. Файловая блокировка исключает одновременные обновления.
2. Checkout получает `origin/main`, определяется commit SHA.
3. Через `git archive` создаётся `/opt/digital-todo/releases/<SHA>` с `index.html`, favicon, `css/`, `js/`, `server/`. Промо-ролик и секреты в релиз не входят.
4. Запускается `npm test --prefix <release>/server`. Тесты используют фиктивных провайдеров и временные базы, production-ключи не читаются.
5. Только после успешных тестов атомарно переключается `current`, затем перезапускается `digital-todo-assistant`.
6. Если локальный `/health` не отвечает успешно, `current` возвращается на предыдущий релиз и служба перезапускается снова.

Проверка health подтверждает запуск процесса, а не работоспособность AI-ключа или фактическую доставку Telegram. Успех модели и личную доставку проверяют отдельно. Первый deployment без предыдущей версии не имеет версии для автоматического отката.

Конфигурации Nginx, systemd и установленный update script не обновляются автоматически вместе с приложением: изменения в `deploy/` администратор применяет отдельно после проверки. Не редактировать env-файл при обычном обновлении.

## Проверка и обслуживание

Безопасные команды, не раскрывающие секреты:

```sh
systemctl status digital-todo-assistant --no-pager
systemctl list-timers digital-todo-update.timer --no-pager
readlink -f /opt/digital-todo/current
curl --fail https://digital-todo.186-246-27-151.sslip.io/health
```

Принудительно проверить новую версию, не дожидаясь таймера:

```sh
sudo systemctl start digital-todo-update.service
sudo systemctl status digital-todo-update.service --no-pager
```

После изменения только env или применения серверного промпта из нового релиза:

```sh
sudo systemctl restart digital-todo-assistant
curl --fail http://127.0.0.1:8787/health
```

Не останавливаться на health. На основном сайте и на GitHub Pages проверить:

- загрузку интерфейса и сохранение задачи после обновления;
- потоковый ответ Диди и остановку генерации;
- корректное изменение ответа после добавления/завершения задачи;
- CORS для двух разрешённых origin, 403 для другого origin;
- отсутствие ключа в статике и Network браузера;
- локальный fallback при недоступном API;
- Telegram: общая webhook-маршрутизация сохраняет прежний сервис; отдельная личная привязка и отправка подготовленной /todo обязательны для проверки доставки reminder.
- Календарь: скачать `.ics` с активными фильтрами и проверить события на весь день без заметок; последующие изменения задач не должны обещаться как автосинхронизация.

Автоматический тестовый набор:

```sh
npm test --prefix /opt/digital-todo/current/server
```

В публичном demo API: 8 запросов/минуту на IP, 4 одновременно, 200 AI-запросов в сутки на процесс, контекст до 100 задач, история до 6 сообщений, максимум 650 токенов и 8000 символов, ожидание провайдера до 20 секунд. Лимит суток сбрасывается при перезапуске; CORS не заменяет авторизацию. Для больших нагрузок потребуются устойчивые лимиты и бюджет у провайдера.

## Готовое задание для Claude Code

```text
Продолжи обслуживание production Digital To-Do. Не создавай второе приложение.

Основной сайт: https://digital-todo.186-246-27-151.sslip.io/
Зеркало: https://supremegoogle.github.io/The-Digital/
Репозиторий: https://github.com/SupremeGoogle/The-Digital, ветка main
SSH: YOUR_SSH_USER@YOUR_SERVER_HOST (доступ предоставлю отдельно)
Корень: /opt/digital-todo
Checkout: /opt/digital-todo/repository
Релизы: /opt/digital-todo/releases/<SHA>
Активная версия: /opt/digital-todo/current
API: /api/assistant и /api/telegram/* на том же HTTPS-домене
Служба: digital-todo-assistant
Env: /etc/digital-todo/assistant.env
Приватная Telegram-база: /var/lib/digital-todo/telegram-reminders.json
Update script: /usr/local/sbin/digital-todo-update, источник deploy/update.sh
Таймер: digital-todo-update.timer, каждые пять минут
RouterAI: https://routerai.ru/api/v1, модель openai/gpt-4.1-mini

Сначала прочитай README, эту инструкцию, docs/TELEGRAM-SETUP.md и deploy/.
Проверь фактические systemd/Nginx-конфигурации, current и последнюю версию
GitHub. Секреты не печатай, не записывай в Git или frontend. Не трогай
другие сайты и службы. Ключи и SSH-доступ получай отдельно защищённым способом.

Telegram работает в общем webhook-режиме с прежним сервисом. Сохраняй
маршрутизацию: только наши /todo dt_<nonce> и совместимые /start dt_… принадлежат Digital To-Do, остальные
updates передаются прежнему private URL с исходным JSON и его успешным
ответом. URL и секреты бери только из серверного env, не выводи их.
Не запускай getUpdates и не отключай прежнее приложение. Если меняешь
регистрацию webhook, сохрани секретную проверку и пересылку. Пользователь
сам нажимает «Подключить» на сайте и отправляет подготовленную /todo в личном чате. Не заявляй
доставку, пока тестовое напоминание действительно не получено.

Сохрани браузерный экспорт Календарь → В календарь телефона: .ics только
с активными задачами со сроками и текущими search/tag фильтрами, события
на весь день, заметки не включать. Это снимок, а не автоматическая подписка.

Убедись, что update timer получает origin/main, создаёт релиз по SHA,
выполняет тесты, атомарно переключает current и восстанавливает прошлую
версию при плохом health. Env и база не должны копироваться в релизы.
Не делай reset --hard и не удаляй чужие файлы. Обновления deploy-конфигов
применяй отдельно после проверки nginx -t и systemd.

Проверь HTTPS, health, реальный потоковый ответ AI, CORS обоих origin,
остановку генерации и fallback. Для проверки используй синтетический
контекст, не отправляй личные задачи без необходимости. Убедись, что
серверные тесты используют fake providers и не расходуют AI-ключ.

В отчёте укажи current SHA, адреса, службу/таймер, результаты проверок и
честный статус Telegram: configured, linked и реально доставлено — разные
состояния. Секреты и содержимое приватной базы никогда не показывай.
```

## Источники и происхождение

- [RouterAI: руководства](https://routerai.ru/docs/guides), [GPT-4.1 Mini](https://routerai.ru/models/openai/gpt-4.1-mini): OpenAI-совместимый Chat Completions API.
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html): reverse proxy, заголовки и буферизация.
- [Node.js CLI](https://nodejs.org/api/cli.html#--env-filefile): локальный запуск с файлом окружения.
- Публичный SmartPal Exonware был недоступен для изучения; Диди — оригинальная SVG/CSS-фигура проекта. Код и ассеты SmartPal не переносились.
