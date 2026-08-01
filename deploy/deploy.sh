#!/usr/bin/env bash
set -euo pipefail
VM="${1:-proofgame}"; DEST="exedev@$VM.exe.xyz"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5"
[ -f "$ROOT/.env" ] && grep -v '^PORT=' "$ROOT/.env" | $SSH "$DEST" 'cat > /etc/proofgame.env && chmod 600 /etc/proofgame.env'
rsync -avh --delete -e "$SSH" --exclude .git --exclude node_modules --exclude artifacts --exclude .env --exclude deploy "$ROOT/" "$DEST:/srv/site/"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"
git -C "$ROOT" diff --quiet 2>/dev/null || SHA="$SHA+"
$SSH "$DEST" "printf '{\"v\":\"%s\",\"at\":\"%s\"}' '$SHA' \"\$(date -u +'%b %d %H:%MZ')\" > /srv/site/version.json; sudo systemctl restart proofgame"
echo "✓ deployed → https://$VM.exe.xyz ($SHA)"
