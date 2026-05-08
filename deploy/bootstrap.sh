#!/usr/bin/env bash
# Server-side bootstrap. Runs ONCE on a fresh Ubuntu 24.04 box, as root.
# Idempotent enough that re-running it is safe.
#
# Usage from the laptop:
#   scp -i ~/.ssh/boop_deploy deploy/bootstrap.sh root@<IP>:/root/
#   ssh -i ~/.ssh/boop_deploy root@<IP> 'bash /root/bootstrap.sh'

set -euo pipefail

DOMAIN="boop.planforadventure.com"
REPO_URL="https://github.com/raroque/boop-agent.git"
NODE_MAJOR=22

echo "==> Updating apt + base packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg ufw jq git build-essential debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" != "${NODE_MAJOR}" ]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating boop user"
if ! id boop >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash boop
fi

echo "==> Cloning repo to /opt/boop/repo (if missing)"
mkdir -p /opt/boop
chown boop:boop /opt/boop
if [ ! -d /opt/boop/repo ]; then
  sudo -u boop git clone "${REPO_URL}" /opt/boop/repo
  # Rename origin → upstream so /upgrade-boop works
  sudo -u boop git -C /opt/boop/repo remote rename origin upstream
fi

echo "==> Installing npm deps"
sudo -u boop bash -c 'cd /opt/boop/repo && npm install'

echo "==> Installing Claude Code CLI globally"
npm install -g @anthropic-ai/claude-code

echo "==> Note: you must run 'claude login' as the boop user to authorize the Agent SDK."
echo "==> Run later: sudo -u boop -H claude login"

echo "==> Writing Caddyfile"
cp /opt/boop/repo/deploy/Caddyfile /etc/caddy/Caddyfile

echo "==> Writing systemd unit"
cp /opt/boop/repo/deploy/boop.service /etc/systemd/system/boop.service
systemctl daemon-reload

echo "==> Enabling host firewall (ufw) — Hetzner Cloud Firewall is the primary; ufw is defense-in-depth"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Restarting Caddy (will get cert once DNS is pointed here)"
systemctl enable --now caddy
systemctl reload caddy || true

echo
echo "==================================================================="
echo "  Bootstrap complete. Next steps:"
echo "  1. (laptop) Add Cloudflare A record: ${DOMAIN} → \$(this server IP)"
echo "  2. (server) sudo -u boop -H claude login    # interactive"
echo "  3. (laptop) scp .env.local to /opt/boop/repo/.env.local"
echo "  4. (server) sudo -u boop bash -c 'cd /opt/boop/repo && npx convex dev --once'"
echo "  5. (server) systemctl enable --now boop"
echo "  6. (laptop) npm run sendblue:webhook -- https://${DOMAIN}/sendblue/webhook"
echo "==================================================================="
