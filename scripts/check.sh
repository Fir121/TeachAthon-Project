#!/bin/sh
set -eu
docker compose exec -T api python -m pytest -q -p no:cacheprovider
npm --prefix apps/web run build
npm --prefix apps/web test
npm --prefix apps/web run test:e2e
