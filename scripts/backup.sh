#!/bin/sh
# Run from repository root. Backups contain course-private data: encrypt off-host copies.
set -eu
backup_dir="${1:-./backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
docker compose exec -T db pg_dump -U lectureloop -Fc lectureloop > "$backup_dir/database.dump"
# Quiesce writers for a consistent media snapshot; restart even if tar fails.
docker compose stop api worker >/dev/null
trap 'docker compose start api worker >/dev/null' EXIT HUP INT TERM
docker compose run --rm --no-deps -T --user root api tar -C /media -czf - . > "$backup_dir/media.tar.gz"
chmod 600 "$backup_dir/database.dump" "$backup_dir/media.tar.gz"
printf 'Backup saved: %s\n' "$backup_dir"
