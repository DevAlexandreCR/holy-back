# Holyverso Backend (HolyVerso)

Node.js + TypeScript + Express + Prisma backend that powers the HolyVerso app. Provides auth, user settings, Bible versions, and daily verse endpoints backed by MySQL and the external bolls.life service.

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

## CI/CD
- On every pull request: `.github/workflows/ci.yml` runs `npm ci`, `prisma generate`, `npm run build`, and `npm test`.
- On push to `master` (or manual dispatch): `.github/workflows/deploy.yml` reuses `ci.yml` as a gate, then SSHes into the production VPS and runs `scripts/deploy/deploy.sh <sha>`, which builds, runs `prisma migrate deploy`, and reloads the `holyverso-api` PM2 process.
- To redeploy an older commit or roll back: GitHub → Actions → `Deploy` → Run workflow → set `sha` to the target commit (leave empty to redeploy current `master`).
- Full server-side runbook, secrets, and rollback details: `docs/back/CD_GITHUB_ACTIONS.md` in the monorepo root.

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
