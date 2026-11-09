#!/usr/bin/env bash
# استقرار growth-hub-next روی سرور: ~/growth-hub-next/deploy.sh (از workflow یا دستی)
set -euo pipefail

# کل اسکریپت داخل main است تا bash قبل از git reset (که خود این فایل را عوض می‌کند) همه را خوانده باشد
main() {
  cd "$(dirname "$0")"

  LOCK_FILE="${HOME}/growth-hub-next/.deploy.lock"
  HEALTH_TIMEOUT_SECONDS=120
  HEALTH_INTERVAL_SECONDS=5

  exec 9>"$LOCK_FILE"
  echo "waiting for deploy lock ${LOCK_FILE}..."
  flock 9

  git fetch origin main
  git reset --hard origin/main

  if [[ ! -f .env ]]; then
    echo "ERROR: .env not found in $(pwd) — copy .env.production.example to .env and fill it" >&2
    exit 1
  fi

  docker compose build
  docker compose up -d

  echo "waiting up to ${HEALTH_TIMEOUT_SECONDS}s for hub-next to become healthy..."
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  status=unknown
  while ((SECONDS < deadline)); do
    id="$(docker compose ps -q hub-next)"
    if [[ -n "$id" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    fi
    if [[ "$status" == healthy ]]; then
      docker compose ps hub-next
      docker image prune -f
      echo "hub-next deployed and healthy"
      exit 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done

  echo "ERROR: hub-next did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s (last status: ${status})" >&2
  docker compose ps hub-next || true
  docker compose logs --no-color --tail 100 hub-next || true
  exit 1
}

main "$@"
