#!/usr/bin/env bash
# Restore a ReportOps backup made by backup.sh.
#
#   podman compose stop backend worker
#   podman volume ls | grep reportops-files        # find the full volume name
#   podman compose run --rm -v <full-volume-name>:/data/attachments backup \
#       bash /restore.sh /backups/daily/2026-11-21_0100
#   podman compose start backend worker
set -euo pipefail
dir=${1:?Usage: restore.sh <backup folder>}
FILES_DIR=${FILES_DIR:-/data/attachments}

(cd "$dir" && sha256sum -c SHA256SUMS)
pg_restore --clean --if-exists --no-owner --dbname="${PGDATABASE:-app}" "$dir/db.dump"
find "$FILES_DIR" -mindepth 1 -delete
tar -xzf "$dir/attachments.tar.gz" -C "$FILES_DIR"
echo "Restore finished from $dir"
