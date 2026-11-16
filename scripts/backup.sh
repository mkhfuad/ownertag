#!/bin/sh
# Nightly database backup for the VPS. Keeps 14 days in /root/ownertag-backups.
# Install once (run on the VPS, inside the app folder):
#   (crontab -l 2>/dev/null; echo "15 3 * * * sh $(pwd)/scripts/backup.sh >> /var/log/ownertag-backup.log 2>&1") | crontab -
# ponytail: local copies only — a dead disk takes them too. Copy the folder
# off-server (Hostinger snapshots, rclone to cloud storage) for real safety.
set -eu
cd "$(dirname "$0")/.."
DIR=/root/ownertag-backups
mkdir -p "$DIR" && chmod 700 "$DIR"
OUT="$DIR/ownertag-$(date +%F).sql.gz"
docker compose exec -T db pg_dump -U ownertag ownertag | gzip > "$OUT.tmp"
[ "$(gzip -dc "$OUT.tmp" | head -c 2000 | wc -c)" -gt 100 ]   # refuse to keep an empty dump
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'ownertag-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
