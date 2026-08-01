#!/usr/bin/env bash
set -euo pipefail
VM="${1:-proofgame}"; DEST="exedev@$VM.exe.xyz"
SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5"
$SSH "$DEST" 'node -e "process.exit(+process.versions.node.split(\".\")[0] >= 20 ? 0 : 1)" 2>/dev/null || {
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs; }'
$SSH "$DEST" 'sudo apt-get install -y -q rsync; sudo mkdir -p /srv/site && sudo chown -R exedev:exedev /srv'
$SSH "$DEST" 'sudo tee /etc/systemd/system/proofgame.service >/dev/null' <<'UNIT'
[Unit]
Description=Proof Game
After=network-online.target
[Service]
User=exedev
EnvironmentFile=/etc/proofgame.env
Environment=PORT=8000
ExecStart=/usr/bin/node /srv/site/server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
$SSH "$DEST" 'sudo touch /etc/proofgame.env && sudo chown exedev:exedev /etc/proofgame.env && sudo chmod 600 /etc/proofgame.env && sudo systemctl daemon-reload && sudo systemctl enable proofgame'
echo "✓ provisioned"
