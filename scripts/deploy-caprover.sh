#!/usr/bin/env bash

set -euo pipefail

caprover_server="${CAPROVER_SERVER:-notify}"
app_name="rune-generator"
archive="dist/rune-generator-deploy.tar"

cleanup() {
  rm -f "$archive"
}
trap cleanup EXIT

./scripts/package-caprover.sh
caprover deploy -t "$archive" -n "$caprover_server" -a "$app_name"
