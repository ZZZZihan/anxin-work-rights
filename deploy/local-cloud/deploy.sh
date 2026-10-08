#!/usr/bin/env bash
set -euo pipefail
target="${1:-carryz@172.23.1.127}"
revision="$(git rev-parse HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit the intended source changes before deployment.' >&2
  exit 1
fi
release="/home/carryz/.local/lib/anxin/releases/$revision"
ssh -o BatchMode=yes "$target" "test ! -e '$release' && mkdir -p '$release'"
git archive "$revision" | ssh -o BatchMode=yes "$target" "tar -x -C '$release'"
ssh -o BatchMode=yes "$target" /bin/bash -s -- "$revision" <<'REMOTE'
set -euo pipefail
revision="$1"
release="/home/carryz/.local/lib/anxin/releases/$revision"
cd "$release"
npm ci --no-audit --no-fund --registry=https://registry.npmjs.org
npm run check
test -f /home/carryz/.config/anxin/config.json
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to /home/carryz/.local/share/anxin/state
node - "$revision" <<'NODE'
const fs = require('node:fs');
const path = '/home/carryz/.config/anxin/config.json';
const config = JSON.parse(fs.readFileSync(path));
config.release = process.argv[2];
fs.writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
NODE
ln -s "$release" /home/carryz/.local/lib/anxin/current.next
mv -Tf /home/carryz/.local/lib/anxin/current.next /home/carryz/.local/lib/anxin/current
install -m 600 deploy/local-cloud/anxin-local.service /home/carryz/.config/systemd/user/anxin-local.service
systemctl --user daemon-reload
systemctl --user enable anxin-local.service
systemctl --user restart anxin-local.service
ANXIN_CONFIG=/home/carryz/.config/anxin/config.json node deploy/local-cloud/readiness.mjs "$revision"
REMOTE
