#!/usr/bin/env bash

set -euo pipefail

archive="dist/rune-generator-deploy.tar"
build_dir="dist/dnd-rune-generator"

bun run build
cp Dockerfile captain-definition "$build_dir/"
tar --exclude='*.map' -cvf "$archive" -C "$build_dir" .
echo "Pacchetto CapRover creato: $archive"
