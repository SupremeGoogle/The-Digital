# Подключение Диди к AI-серверу

Сейчас сайт работает с локальным помощником. Он считает задачи, прогресс и просрочки, предлагает порядок дел и объясняет интерфейс. Это детерминированные ответы по данным браузера, а не подключённая языковая модель. Провайдер выбран — RouterAI. Внешний сервер ещё не развёрнут, а метатег assistant-endpoint на сайте пуст: вопросы пока не отправляются в AI. Успешная проверка ключа у провайдера сама по себе не подключает сайт к серверу.

В репозитории уже есть готовый серверный адаптер `server/index.mjs`. Он подключается к **OpenAI-совместимому Chat Completions API**. Используется **RouterAI (routerai.ru)**: `AI_BASE_URL=https://routerai.ru/api/v1`, `AI_MODEL=openai/gpt-4.1-mini`. Его Chat Completions API совместим с текущим адаптером. RouterAI и OpenRouter — разные сервисы; ключ требуется именно от RouterAI.

## Что потребуется

- Доступ SSH к своему Linux-серверу с правами для настройки службы и HTTPS.
- Домен для API, например `assistant.YOUR-DOMAIN.example`, и DNS на IP сервера.
- Ключ RouterAI из кабинета routerai.ru. База API и модель уже выбраны ниже; ключ вводится только на сервере.
- Репозиторий: `https://github.com/SupremeGoogle/The-Digital`.
- Фронтенд: `https://supremegoogle.github.io/The-Digital/`.

Ключ вводится **на сервере** в защищённый файл. Его нельзя добавлять в HTML, JavaScript, репозиторий, GitHub Pages, URL, примеры ответов или отчёт Claude Code. В переписку ключ присылать не нужно.

## Архитектура

Браузер → `https://assistant.YOUR-DOMAIN.example/api/assistant` → Node.js → RouterAI.

Браузер отправляет вопрос, краткую историю и контекст задач: названия, статусы, приоритеты, метки, сроки, числа подзадач. **Заметки и ссылки из заметок не передаются.** Ответ показывается как текст. Модель не может удалять, создавать или менять задачи, выполнять команды или обращаться к другим адресам.

Сайт на GitHub Pages остаётся статическим. API работает отдельной службой на вашем сервере, а его исходники берутся из того же репозитория. Проверяющему не нужен ключ: он открывает сайт и использует готовый API. При ошибке API помощник возвращается к локальным ответам.

## Подготовка и проверка сервера

Пример ниже рассчитан на Linux с systemd и Nginx. Перед применением заменить значения `YOUR_…`, проверить существующие службы, домены и пути. Не перезаписывать другие приложения на сервере.

1. Установить поддерживаемый Node.js 24, Git и Nginx, если они отсутствуют. Node 20.12+ также поддерживается адаптером. Использовать официальный источник Node.js или штатный доверенный репозиторий ОС.
2. Создать отдельного системного пользователя `digital-todo` и разместить checkout в `/opt/digital-todo`. Исходники должны быть доступны этому пользователю; ключ — только root.
3. Клонировать `main`:

```sh
git clone --branch main https://github.com/SupremeGoogle/The-Digital.git /opt/digital-todo
cd /opt/digital-todo
node --check server/index.mjs
node --test server/assistant.test.mjs
```

Внешних npm-зависимостей нет. `npm install` не требуется.

### Секреты

Создать каталог `/etc/digital-todo` с правами `700`. Создать `/etc/digital-todo/assistant.env`, владелец root, права `600`. Заполнить через редактор или менеджер секретов на сервере:

```dotenv
HOST=127.0.0.1
PORT=8787
CORS_ORIGIN=https://supremegoogle.github.io
AI_BASE_URL=https://routerai.ru/api/v1
AI_MODEL=openai/gpt-4.1-mini
AI_API_KEY=ENTER_REAL_KEY_ON_SERVER_ONLY
TELEGRAM_BOT_TOKEN=ENTER_REAL_TOKEN_ON_SERVER_ONLY
MAX_REQUESTS_PER_MINUTE=8
MAX_DAILY_REQUESTS=200
TRUST_PROXY=true
```

`AI_BASE_URL` должен быть базой API, без `/chat/completions` в конце: адаптер добавляет этот путь сам. Origin GitHub Pages — `https://supremegoogle.github.io`, **без `/The-Digital/`**. Для локальной проверки можно временно добавить `http://localhost:5174` через запятую. Звёздочка в CORS запрещена.

Не запускать `cat`, `env`, `printenv` или команды с ключом в аргументах для отчёта. Не использовать `set -x`. Не коммитить секретный файл. Проверять только имена переменных и факт настройки, не значения.

### Служба systemd

Создать `/etc/systemd/system/digital-todo-assistant.service`. Сначала уточнить `command -v node` и подставить реальный абсолютный путь в `ExecStart`.

```ini
[Unit]
Description=Digital To-Do assistant API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=digital-todo
Group=digital-todo
WorkingDirectory=/opt/digital-todo
EnvironmentFile=/etc/digital-todo/assistant.env
ExecStart=/usr/bin/node /opt/digital-todo/server/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/opt/digital-todo
StateDirectory=digital-todo
StateDirectoryMode=0700
UMask=0077

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now digital-todo-assistant
curl --fail http://127.0.0.1:8787/health
```

Ожидается `{"ok":true,"aiConfigured":true}`. Значение `false` означает, что переменные отсутствуют или содержат заглушки. Оно не подтверждает работоспособность ключа: для этого нужен реальный POST-запрос после настройки.

### Nginx и HTTPS

Создать **отдельный** virtual host для `assistant.YOUR-DOMAIN.example`. Начальный HTTP-конфиг для получения TLS-сертификата:

```nginx
server {
    listen 80;
    server_name assistant.YOUR-DOMAIN.example;
    client_max_body_size 48k;

    location = /health {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
    }

    location = /api/assistant {
        proxy_pass http://127.0.0.1:8787;
        proxy_buffering off;
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 25s;
        proxy_connect_timeout 5s;
    }

    location /api/telegram/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 15s;
    }

    location / { return 404; }
}
```

Проверить `nginx -t`, затем подключить сертификат через штатный механизм сервера, например уже установленный Certbot/Nginx. Итоговый адрес API **обязательно HTTPS**, HTTP должен перенаправляться на HTTPS. Не отключать проверку TLS. Порт 8787 слушает только localhost; наружу его открывать не нужно.

`TRUST_PROXY=true` разрешён здесь потому, что Nginx **перезаписывает** X-Forwarded-For адресом соединения. При прямом доступе к Node оставить `false`.

### Подключение фронтенда

В `<head>` файла `index.html` добавить или заменить **одну** запись:

```html
<meta name="assistant-endpoint" content="https://assistant.YOUR-DOMAIN.example/api/assistant">
```

В ней только публичный URL — без ключа, токена и параметров авторизации. Пустая запись или её отсутствие включает локальный режим без внешних запросов.

После проверки закоммитить только настройку URL и нужные несекретные изменения в `main` и отправить в `origin/main`, чтобы GitHub Pages обновился. Ключ остаётся в `/etc/digital-todo/assistant.env`, вне checkout.

## Проверка после подключения

1. `/health` через HTTPS возвращает 200 и `aiConfigured: true`.
2. POST `/api/assistant` с `Origin: https://supremegoogle.github.io` и тестовым контекстом возвращает JSON с непустым `answer`.
3. Другой Origin получает 403. Неправильный JSON — 400, слишком большой запрос — 413, превышение лимита — 429.
4. На опубликованном сайте открыть помощника и спросить «Сколько задач осталось?», «Что важнее?» и свободный вопрос по планированию. В виджете появляется статус «Помощник по задачам · с AI».
5. Добавить/выполнить задачу и повторить вопрос: контекст обновляется при каждом запросе.
6. Убедиться через Network, что ключа нет в запросе браузера, в статических файлах и истории Git. В браузере есть только вопрос и контекст задач.
7. При остановке API виджет честно пишет о недоступности сервера и даёт локальный ответ. Восстановить службу после проверки.

## Обновление из репозитория

Исходники связаны с GitHub через обычный checkout. Для обновления:

```sh
cd /opt/digital-todo
git fetch origin main
git merge --ff-only origin/main
node --test server/assistant.test.mjs
sudo systemctl restart digital-todo-assistant
curl --fail http://127.0.0.1:8787/health
```

Перед обновлением проверить чистоту checkout. Не использовать `reset --hard` или удаление локальных файлов. Для автоматического deployment можно позже добавить GitHub Actions по SSH с отдельным ограниченным deploy-ключом в GitHub Secrets; сейчас ключи и доступы для этого отсутствуют, автоматическая синхронизация не заявляется. Не создавать публичный webhook без проверки подписи.

## Ограничения демонстрационного API

Это публичный demo endpoint с точным CORS origin, лимитом 8 запросов/минуту на адрес, 4 параллельными запросами и общим лимитом 200 AI-запросов в сутки. Дневной лимит хранится в памяти и сбрасывается при перезапуске. CORS сам по себе не защищает от прямых запросов сторонними клиентами. Для публичной эксплуатации установить расходный лимит в кабинете провайдера; для большей нагрузки добавить устойчивое хранилище лимитов и подходящую авторизацию. Тело запроса — до 48 КБ, контекст — до 100 задач, история — до 6 сообщений, ожидание провайдера — 20 секунд. Ассистент не связан с Telegram: для Telegram потребуется отдельная интеграция, bot token и согласованный способ связывания пользователей с их задачами.

## Готовый промпт для Claude Code

Скопируйте этот текст в Claude Code, имеющий доступ к вашему серверу. Плейсхолдеры заполните несекретными данными; реальный AI-ключ вводите только в защищённом редакторе/хранилище на сервере.

```text
Разверни сервер помощника Диди для моего проекта Digital To-Do.

Репозиторий: https://github.com/SupremeGoogle/The-Digital
Ветка: main
Фронтенд: https://supremegoogle.github.io/The-Digital/
Сервер SSH: YOUR_SSH_USER@YOUR_SERVER_IP
Домен API: assistant.YOUR-DOMAIN.example
Каталог проекта: /opt/digital-todo
Провайдер: RouterAI (routerai.ru), не OpenRouter
OpenAI-compatible base URL: https://routerai.ru/api/v1
Модель: openai/gpt-4.1-mini
Ключ: введу на сервере в /etc/digital-todo/assistant.env, не в переписке.

Сначала прочитай docs/CLAUDE-DEPLOY-ASSISTANT.md, server/index.mjs,
server/.env.example и текущий index.html. Проверь актуальные инструкции
репозитория и официальную документацию RouterAI: https://routerai.ru/docs/guides.
Используй выбранные базу API и модель. Не подменяй RouterAI сервисом
OpenRouter. Ключ не добавляй в репозиторий и не печатай.

Проверь ОС, существующие Nginx-сайты, Node.js и занятые порты. Установи
только необходимое из доверенных источников. Не затрагивай другие сайты.
Настрой отдельную службу digital-todo-assistant от непривилегированного
пользователя. Код получай из моего репозитория, секреты держи вне checkout.
Установи права 600 для root на env-файл; никогда не печатай его содержимое,
ключи или заголовок Authorization в вывод, логи, отчёт или Git.

Настрой localhost:8787, точный CORS_ORIGIN=https://supremegoogle.github.io,
таймауты и demo-лимиты. Сделай HTTPS reverse proxy на указанном домене,
проверь nginx -t и автоматическое обновление сертификата. Не открывай
порт Node наружу. Убедись, что X-Forwarded-For перезаписывается прокси.

Обнови meta assistant-endpoint в index.html публичным HTTPS URL API,
без ключей. Сохрани локальный fallback и все существующие функции сайта.
Не внедряй ключ в frontend или GitHub Pages. Не подключай Telegram без
отдельно согласованного bot token и сопоставления пользователей.

Проверь серверные тесты, health, реальный ответ модели, CORS, ошибочный
запрос, лимиты и fallback. В браузере на опубликованном сайте проверь
изменение контекста после добавления и завершения задачи. Только после
проверки закоммить и отправь несекретные изменения в origin/main.

Подготовь безопасную команду обновления из origin/main с тестами и
перезапуском службы. Если на сервере уже есть CI/CD, используй его;
если нет, оставь документированный git pull/update процесс и не заявляй,
что автоматический deployment уже настроен. Не создавай webhook без
проверки подписи и не используй reset --hard.

В отчёте дай URL сайта, URL health, результат реального теста AI,
название модели, способ обновления, пути службы и env-файла. Покажи
только факт наличия секрета, никогда его значение. Если чего-то не хватает,
укажи конкретный блокер и уже выполненные шаги, не имитируй успех.
```

## Источники и происхождение

- [RouterAI: руководства](https://routerai.ru/docs/guides), [GPT-4.1 Mini](https://routerai.ru/models/openai/gpt-4.1-mini): база `https://routerai.ru/api/v1`, модель `openai/gpt-4.1-mini`, Bearer-аутентификация и OpenAI-совместимый Chat Completions endpoint.

- [Exonware на GitHub](https://github.com/Exonware): изучена организация, но публичный SmartPal не найден; прямой запрос `Exonware/smartpal` через GitHub возвращал 404. Нельзя утверждать, что его исходники или точное поведение изучены. Диди — оригинальная SVG/CSS-фигура, код/ассеты SmartPal не переносились.
- [Node.js CLI: env-file](https://nodejs.org/api/cli.html#--env-filefile): локальный запуск с файлом окружения.
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html): HTTPS reverse proxy и заголовки.
- [Docker: environment variables](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/): для контейнерного запуска есть `server/Dockerfile`; в публичном образе секретов быть не должно. Основной описанный путь — systemd с отдельным защищённым env-файлом.

## Живые реакции Диди

Диди локально замечает добавление, завершение, перенос, удаление и изменение приоритета/срока задачи. Короткая реплика появляется не чаще одного раза в 12 секунд и исчезает через 4 секунды. Во время ввода, перетаскивания и открытого чата реплики скрыты. Фоновые события никогда не отправляются в AI; сеть используется только после вопроса пользователя. Автоматическая поддержка reduced motion сохраняется, ручного тихого режима нет.
