#!/usr/bin/env bash
# Install the language packages used by code-sandbox into a running Piston instance.
# Usage: PISTON=https://piston-aradrsk.fly.dev ./install-languages.sh

set -euo pipefail
: "${PISTON:?set PISTON to your Piston base URL, e.g. https://piston-aradrsk.fly.dev}"

pkgs=(
  "python 3.12.0"
  "node 20.11.1"
  "typescript 5.0.3"
  "bash 5.2.0"
  "ruby 3.0.1"
  "go 1.16.2"
)

for p in "${pkgs[@]}"; do
  lang="${p%% *}"
  ver="${p##* }"
  echo "installing $lang $ver ..."
  curl -fsS -X POST "$PISTON/api/v2/packages" \
    -H "content-type: application/json" \
    -d "{\"language\":\"$lang\",\"version\":\"$ver\"}" \
    && echo
done
