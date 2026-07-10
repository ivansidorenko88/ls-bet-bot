# LS BET — миграция SQLite → PostgreSQL на Bothost

## Что уже подготовлено

- `prisma/schema.prisma` переведён на PostgreSQL.
- Добавлена начальная PostgreSQL-миграция Prisma.
- Добавлен отдельный Prisma-клиент для чтения старой SQLite-базы.
- Добавлен перенос всех таблиц с сохранением ID и связей.
- Добавлена синхронизация PostgreSQL sequences.
- Добавлена автоматическая сверка количества строк и денежных сумм.
- Исходная база находится в `prisma/dev.db`.
- Исходная SQLite-схема сохранена в `backup/original-sqlite-schema.prisma`.

## Данные, найденные в исходной базе

- Пользователи: **43**
- Общий баланс пользователей: **$62,472**
- Ставки на события: **75**
- Денежные транзакции: **543**
- Ставки CRASH: **48**
- Раунды CRASH: **7029**
- Вклады Jackpot War: **120**
- Логи: **7547**
- Нарушения внешних ключей SQLite: **0**

Подробный отчёт: `MIGRATION_SOURCE_REPORT.json`.

## Важно перед началом

1. Остановите бота на Bothost.
2. Скачайте резервную копию текущего `prisma/dev.db`.
3. Пароль PostgreSQL был виден на присланном скриншоте. Пересоздайте базу или смените пароль перед подключением.
4. Не публикуйте строку `DATABASE_URL` и не добавляйте `.env` в GitHub.
5. Не запускайте бота до завершения команды `npm run migration:verify`.

## Переменные окружения Bothost

В панели Bothost замените старую SQLite-строку:

```env
DATABASE_URL="file:./prisma/dev.db"
```

на новую PostgreSQL-строку из карточки базы:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Дополнительно можно указать:

```env
SQLITE_DATABASE_URL="file:./dev.db"
MIGRATION_ALLOW_NONEMPTY=false
```

`SQLITE_DATABASE_URL` относится к файлу `prisma/dev.db`, потому что SQLite-схема лежит в каталоге `prisma`.

## Порядок запуска на Bothost

В терминале проекта выполните строго по порядку:

```bash
npm install
npm run db:deploy
npm run migration:run
npm run migration:verify
```

Успешная проверка завершится строкой:

```text
✅ All counts and financial totals match.
```

После этого запустите бота:

```bash
npm start
```

Slash-команды обновляйте только при необходимости:

```bash
npm run commands
```

## Если миграция прервалась

Не запускайте бота. Исправьте причину и повторите:

```bash
MIGRATION_ALLOW_NONEMPTY=true npm run migration:run
npm run migration:verify
```

`MIGRATION_ALLOW_NONEMPTY=true` разрешено использовать только для продолжения этой же частично выполненной миграции.

## Проверка после запуска

Проверьте:

- баланс нескольких пользователей;
- историю транзакций;
- активные события и ставки;
- заявки на пополнение и вывод;
- Jackpot War;
- CRASH и авто-кэшаут;
- лотерею;
- промокоды и рефералов;
- админские денежные логи.

## Откат

Если проверка не прошла:

1. Остановите бота.
2. Не удаляйте PostgreSQL-базу до выяснения причины.
3. Верните старую версию проекта со SQLite-схемой.
4. Верните резервный `prisma/dev.db`.
5. Верните старое значение `DATABASE_URL="file:./prisma/dev.db"`.

Храните старый `dev.db` минимум 7 дней после успешного перехода.
