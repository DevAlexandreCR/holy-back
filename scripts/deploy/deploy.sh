#!/usr/bin/env bash
#
# Deploy holy-back to production.
#
# Invoked over SSH by .github/workflows/deploy.yml as the unprivileged
# `deploy` service user (never root), or manually on the server:
#
#   scripts/deploy/deploy.sh --check          # preflight only, no changes
#   scripts/deploy/deploy.sh <40-char-git-sha> # fetch/checkout/build/migrate/reload
#
# See docs/back/CD_GITHUB_ACTIONS.md for the full runbook, sudoers setup, and
# the rollback drill. This script never touches nginx or any VPS outside the
# API directory, and never runs `git clean` (it must preserve .env,
# node_modules, storage/, and web/).

set -Eeuo pipefail

main() {
  # --- Helpers (nested so the whole body is parsed before anything runs) ---

  usage() {
    echo "Usage: $0 <40-char-git-sha>|--check" >&2
    exit 1
  }

  log() {
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '[%s] %s\n' "$ts" "$*"
    if [[ -w "$LOG_DIR" ]]; then
      printf '[%s] %s\n' "$ts" "$*" >>"$LOG_FILE" 2>/dev/null || true
    fi
  }

  die() {
    log "FATAL: $*"
    exit 1
  }

  on_err() {
    local exit_code=$?
    # Disarm immediately, and track with a flag, so nothing below (or a
    # future edit above this line) can re-enter this handler within the same
    # shell. Note this does NOT fully dedupe a failing COMMAND SUBSTITUTION
    # assignment (e.g. `prev_sha="$(git rev-parse HEAD)"` failing): with
    # errtrace, that runs in its own forked subshell which gets its own copy
    # of on_err_fired, so this trap fires once there and once more, for
    # real, in the parent shell when the assignment itself reports failure.
    # That's an unavoidable consequence of how bash scopes subshells, not a
    # bug here -- it's bounded to those two firings (never more), and since
    # everything below is stderr-only (see note by the printf calls), the
    # subshell firing can't corrupt the variable being assigned.
    if [[ "${on_err_fired:-0}" == "1" ]]; then
      exit "$exit_code"
    fi
    on_err_fired=1
    trap - ERR
    # Deliberately NOT `log(...)` here: log() prints to stdout, and when this
    # handler runs inside the subshell of a failing command substitution
    # (e.g. `prev_sha="$(git rev-parse HEAD)"` failing), anything written to
    # that subshell's stdout becomes PART OF THE CAPTURED VALUE being
    # assigned -- corrupting prev_sha (or whatever variable) with this very
    # error message instead of leaving it empty. Everything on_err prints
    # must go to stderr only.
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '[%s] ERROR: deploy failed (exit %s)\n' "$ts" "$exit_code" >&2
    if [[ -w "$LOG_DIR" ]]; then
      printf '[%s] ERROR: deploy failed (exit %s)\n' "$ts" "$exit_code" >>"$LOG_FILE" 2>/dev/null || true
    fi
    if [[ -n "${prev_sha:-}" ]]; then
      {
        echo "Rollback (code only — this does NOT revert the DB schema):"
        echo "  cd '$API_DIR' && git fetch -q --no-tags origin $prev_sha && git checkout -q -f -B master $prev_sha && npm ci --no-audit --no-fund && npx prisma generate && npm run build && sudo -n -H '$PM2_BIN' reload '$PM2_APP'"
      } >&2
    fi
    echo "NOTE: a code rollback does NOT revert the database schema." >&2
    echo "There is no automatic pre-migration snapshot. If a migration must be undone," >&2
    echo "restore the database from the latest backup." >&2
    exit "$exit_code"
  }

  ensure_node() {
    if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
      # shellcheck source=/dev/null
      source "$HOME/.nvm/nvm.sh"
    fi
    command -v node >/dev/null 2>&1 || die "node not found on PATH (and no ~/.nvm/nvm.sh to source)"
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    [[ "$major" -ge 20 ]] || die "node >= 20 required, found $(node -v)"
  }

  preflight() {
    local failures=()

    if ! git -C "$API_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      failures+=("$API_DIR is not a git repository")
    elif ! git -C "$API_DIR" ls-remote -q --exit-code origin HEAD >/dev/null 2>&1; then
      failures+=("cannot reach origin from $API_DIR (git ls-remote failed)")
    fi

    command -v node >/dev/null 2>&1 || failures+=("node not found on PATH")

    local bin
    for bin in jq curl flock; do
      command -v "$bin" >/dev/null 2>&1 || failures+=("$bin not found on PATH")
    done

    local sudo_list
    sudo_list="$(sudo -n -l 2>&1 || true)"
    echo "$sudo_list" | grep -qF "$PM2_BIN" || failures+=("sudoers: no NOPASSWD entry for $PM2_BIN reload")

    [[ -f "$API_DIR/.env" ]] || failures+=("$API_DIR/.env not found")

    mkdir -p "$LOG_DIR" 2>/dev/null || true
    [[ -w "$LOG_DIR" ]] || failures+=("log dir not writable: $LOG_DIR")

    if [[ ${#failures[@]} -gt 0 ]]; then
      local f
      for f in "${failures[@]}"; do
        echo "preflight: $f" >&2
      done
      return 1
    fi
  }

  run_migrations() {
    local migrate_log
    migrate_log="$(mktemp)"

    # Mirrors scripts/security/migrate-with-snapshot.sh's DATABASE_URL override:
    # prefer MIGRATE_DATABASE_URL from .env when set, without sourcing the file.
    # MIGRATE_DATABASE_URL is optional: grep finding no match is expected, not
    # an error, so its exit status must not escape this command substitution
    # (under `set -e`/pipefail it otherwise kills the whole script silently).
    local migrate_db_url=""
    if [[ -f "$API_DIR/.env" ]]; then
      migrate_db_url="$(grep -m1 '^MIGRATE_DATABASE_URL=' "$API_DIR/.env" | cut -d= -f2- || true)"
      migrate_db_url="${migrate_db_url%\"}"
      migrate_db_url="${migrate_db_url#\"}"
      migrate_db_url="${migrate_db_url%\'}"
      migrate_db_url="${migrate_db_url#\'}"
    fi

    # `npx_migrate` wraps the DATABASE_URL override as a plain if/else instead
    # of building an env-prefix array and expanding it: avoids relying on
    # "${arr[@]}" being a no-op for an empty array under `set -u` (true on
    # bash >= 4.4, but not guaranteed on every shell this script might run
    # under), and keeps the common case (no override) a straight code path.
    npx_migrate() {
      if [[ -n "$migrate_db_url" ]]; then
        env "DATABASE_URL=$migrate_db_url" npx prisma migrate deploy
      else
        npx prisma migrate deploy
      fi
    }

    if ! npx_migrate 2>&1 | tee "$migrate_log"; then
      log "ERROR: migration failed, see output above"
      rm -f "$migrate_log"
      return 1
    fi

    local applied
    if grep -q 'No pending migrations to apply' "$migrate_log"; then
      applied=0
    else
      applied="$(grep -cF 'migration.sql' "$migrate_log" || true)"
    fi
    log "applied migrations: $applied"

    rm -f "$migrate_log"
  }

  wait_for_health() {
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
      if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
        log "health 200 after $i tries"
        return 0
      fi
      sleep "$HEALTH_SLEEP"
    done

    log "ERROR: health check failed after $HEALTH_RETRIES tries"
    if [[ -f "$PM2_ERROR_LOG" ]]; then
      echo "---- tail -n 40 $PM2_ERROR_LOG ----" >&2
      tail -n 40 "$PM2_ERROR_LOG" >&2 || true
    fi
    return 1
  }

  check_pm2_status() {
    local status
    status="$(sudo -n -H "$PM2_BIN" jlist | jq -r --arg app "$PM2_APP" \
      '.[] | select(.name == $app) | "\(.pm2_env.status) restarts=\(.pm2_env.restart_time) version=\(.pm2_env.version // "n/a")"')"
    [[ -n "$status" ]] || die "pm2 jlist has no entry for $PM2_APP"
    log "pm2 status: $status"
    [[ "$status" == online* ]] || die "pm2 app $PM2_APP is not online: $status"
  }

  # --- Args ---

  [[ $# -eq 1 ]] || usage

  local mode="$1" target_sha=""
  if [[ "$mode" == "--check" ]]; then
    mode="check"
  elif [[ "$mode" =~ ^[0-9a-f]{40}$ ]]; then
    target_sha="$mode"
    mode="deploy"
  else
    usage
  fi

  [[ "$EUID" -ne 0 ]] || { echo "Refusing to run as root; run as the 'deploy' service user." >&2; exit 1; }

  # --- Config (env-overridable) ---

  API_DIR="${API_DIR:-/var/www/holyverso}"
  PM2_BIN="${PM2_BIN:-/usr/bin/pm2}"
  PM2_APP="${PM2_APP:-holyverso-api}"
  HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
  HEALTH_RETRIES="${HEALTH_RETRIES:-15}"
  HEALTH_SLEEP="${HEALTH_SLEEP:-2}"
  LOG_DIR="${LOG_DIR:-/var/log/holyverso-deploy}"
  LOG_FILE="$LOG_DIR/api.log"
  LOCK_FILE="${LOCK_FILE:-/run/lock/holyverso-deploy-api.lock}"
  PM2_ERROR_LOG="${PM2_ERROR_LOG:-/var/www/holyverso/logs/err.log}"

  local prev_sha=""
  local on_err_fired=0

  log "holy-back deploy.sh starting (mode=$mode${target_sha:+ sha=$target_sha})"

  ensure_node

  if [[ "$mode" == "check" ]]; then
    preflight
    log "preflight OK"
    return 0
  fi

  # --- Serialize concurrent deploys ---
  local lock_fd
  exec {lock_fd}>"$LOCK_FILE" || die "cannot open lock file: $LOCK_FILE"
  flock -w 60 "$lock_fd" || die "could not acquire deploy lock within 60s: $LOCK_FILE"

  trap on_err ERR

  preflight

  prev_sha="$(git -C "$API_DIR" rev-parse HEAD)"

  cd "$API_DIR" || die "cannot cd to $API_DIR"

  git fetch -q --no-tags origin "$target_sha"
  git checkout -q -f -B master "$target_sha"
  log "checked out $target_sha (was $prev_sha)"

  npm ci --no-audit --no-fund
  log "dependencies installed"

  # holy-back's `npm run build` is plain `tsc` (unlike libi-api, it does not
  # run `prisma generate` itself), so generate the client explicitly first.
  npx prisma generate
  log "prisma client generated"

  nice -n 10 npm run build
  log "build ok"

  run_migrations

  sudo -n -H "$PM2_BIN" reload "$PM2_APP"
  log "pm2 reload issued"

  wait_for_health

  check_pm2_status

  log "deploy complete: $target_sha"
}

main "$@"
