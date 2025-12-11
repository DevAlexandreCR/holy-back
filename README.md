# Holyverso Backend (Bible Widget)

Node.js + TypeScript + Express + Prisma backend that powers the Bible Widget app. Provides auth, user settings, Bible versions, and daily verse endpoints backed by MySQL and the external bible-api.deno.dev service.

## Setup
- Install dependencies: `npm install`
- Copy `.env.example` to `.env` and fill values (DB creds, JWT secrets, Bible API base URL, cron schedules).
- Generate Prisma client (optional if already generated): `npm run prisma:generate`

## Database
- Apply migrations (creates schema locally): `npm run prisma:migrate`
- Deploy migrations to another env: `npm run prisma:migrate:deploy`

## Seeds / Sync
- Sync Bible versions from the external API: `npm run sync:bible-versions`

## Running
- Dev (watch): `npm run dev`
- Build: `npm run build`
- Production start (uses compiled dist): `npm start`

## Cron Job
- Bible versions sync runs once on startup and then daily.
  - Schedule configured via `BIBLE_VERSIONS_CRON` (defaults to `15 0 * * *`, i.e., 00:15 UTC).
- The verse-of-the-day cron registers on server start.
  - Schedule configured via `CRON_SCHEDULE` (defaults to `5 0 * * *`, i.e., 00:05 UTC).

## API Quickstart
- Register:
  ```sh
  curl -X POST http://localhost:3000/auth/register \
    -H "Content-Type: application/json" \
    -d '{"name":"Alex","email":"alex@example.com","password":"changeme123"}'
  ```
- Login:
  ```sh
  curl -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"alex@example.com","password":"changeme123"}'
  ```
- Get Bible versions:
  ```sh
  curl -H "Authorization: Bearer <ACCESS_TOKEN>" http://localhost:3000/bible/versions
  ```
- Update preferred version:
  ```sh
  curl -X PUT http://localhost:3000/user/settings/version \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"version_id":1}'
  ```
- Get today’s verse:
  ```sh
  curl -H "Authorization: Bearer <ACCESS_TOKEN>" http://localhost:3000/verse/today
  ```
- Widget verse (optional version override):
  ```sh
  curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
    "http://localhost:3000/widget/verse?version_id=1"
  ```

Responses follow the envelope:
- Success: `{"data": ...}`
- Error: `{"error": {"message": "...", "code": "..."}}`
