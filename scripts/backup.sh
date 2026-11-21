#!/usr/bin/env bash
# ReportOps backup: database dump + copy of the attachment files.
# Keeps 14 daily and 8 weekly copies (weekly = the Sunday copy).
#
#   bash scripts/backup.sh          # one backup now (inside the backup container)
#   bash scripts/backup.sh --loop   # run every day at BACKUP_HOUR (default 01, Asia/Jakarta)
set -euo pipefail

BACKUP_ROOT=${BACKUP_ROOT:-/backups}
FILES_DIR=${FILES_DIR:-/data/attachments}

backup_once() {
  local stamp dir
  stamp=$(date +%Y-%m-%d_%H%M)
  dir="$BACKUP_ROOT/daily/$stamp"
  mkdir -p "$dir"
  pg_dump --format=custom --file="$dir/db.dump"
  tar -czf "$dir/attachments.tar.gz" -C "$FILES_DIR" .
  (cd "$dir" && sha256sum db.dump attachments.tar.gz > SHA256SUMS)
  if [ "$(date +%u)" = "7" ]; then
    mkdir -p "$BACKUP_ROOT/weekly"
    cp -r "$dir" "$BACKUP_ROOT/weekly/$stamp"
  fi
  # retention
  ls -1d "$BACKUP_ROOT"/daily/*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
  ls -1d "$BACKUP_ROOT"/weekly/*/ 2>/dev/null | sort | head -n -8 | xargs -r rm -rf
  echo "$(date -Is) backup done: $dir"
}

if [ "${1:-}" = "--loop" ]; then
  while true; do
    if [ "$(date +%H)" = "${BACKUP_HOUR:-01}" ]; then
      backup_once || echo "$(date -Is) backup FAILED" >&2
      sleep 3600
    fi
    sleep 300
  done
else
  backup_once
fi
