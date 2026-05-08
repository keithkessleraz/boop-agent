# Provision the Boop Hetzner server

One-time provisioning of the Boop production server. Idempotent enough that re-running mostly no-ops, but only run this when you actually intend to create or rebuild infrastructure.

**Arguments:** $ARGUMENTS (optional: a server type override like `cax11`; defaults to `cx23`)

---

## Prereqs (verify before running)

- `hcloud` CLI installed, context active (`hcloud context list`)
- `~/.ssh/boop_deploy` exists; `boop-deploy` SSH key registered with Hetzner (`hcloud ssh-key list`)
- DNS for `planforadventure.com` is on Cloudflare (you'll add the A record manually after provisioning)

## Steps

### 1. Create firewall (if missing)
```bash
hcloud firewall list | grep -q boop-fw || \
  hcloud firewall create --name boop-fw --rules-file deploy/firewall-rules.json
```

### 2. Create the server
Default SKU is `cx23` (x86, 2 vCPU, 4 GB, ~€4.85/mo). Override via `$ARGUMENTS`.

```bash
TYPE="${ARGUMENTS:-cx23}"
hcloud server create \
  --name boop \
  --type "$TYPE" \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key boop-deploy \
  --firewall boop-fw
```

Capture the IPv4 from the output. It also shows up in `hcloud server describe boop`.

### 3. Add the IP to the safety hook

Edit `.claude/settings.json` and replace `@BOOP_IP_PLACEHOLDER` with `@<the-IP>` so the BOOP-OK guard catches commands that target the server by IP.

### 4. Cloudflare DNS

Manual: in the Cloudflare dashboard for `planforadventure.com`, add an A record:
- Name: `boop`
- Content: `<the-IP>`
- Proxy: **DNS only** (gray cloud — Caddy needs direct traffic for the cert challenge)
- TTL: Auto

### 5. Bootstrap the server
```bash
scp -i ~/.ssh/boop_deploy deploy/bootstrap.sh root@<IP>:/root/    # BOOP-OK
ssh -i ~/.ssh/boop_deploy root@<IP> 'bash /root/bootstrap.sh'     # BOOP-OK
```

### 6. Hand off Claude Code login (interactive — you do this part)
```bash
ssh -i ~/.ssh/boop_deploy root@<IP> 'sudo -u boop -H claude login'    # BOOP-OK
```
Follow the device-flow URL it prints. This is one-time per ~year.

### 7. Copy `.env.local` from your laptop to the server
```bash
scp -i ~/.ssh/boop_deploy .env.local root@<IP>:/opt/boop/repo/.env.local    # BOOP-OK
ssh -i ~/.ssh/boop_deploy root@<IP> 'chown boop:boop /opt/boop/repo/.env.local && chmod 600 /opt/boop/repo/.env.local'    # BOOP-OK
```

Edit on the server: change `PUBLIC_URL=` to `https://boop.planforadventure.com`.

### 8. Generate Convex types on the server
```bash
ssh -i ~/.ssh/boop_deploy root@<IP> 'sudo -u boop bash -c "cd /opt/boop/repo && npx convex dev --once"'    # BOOP-OK
```

### 9. Start the service
```bash
ssh -i ~/.ssh/boop_deploy root@<IP> 'systemctl enable --now boop && systemctl status boop --no-pager'    # BOOP-OK
```

### 10. Smoke test
```bash
curl -fsS https://boop.planforadventure.com/health
ssh -i ~/.ssh/boop_deploy root@<IP> 'journalctl -u boop --no-pager -n 30'    # BOOP-OK
```

### 11. Re-point Sendblue's webhook (run on the laptop, not the server)
```bash
npm run sendblue:webhook -- https://boop.planforadventure.com/sendblue/webhook
```

Now text your Sendblue number — the new server should reply.

---

## Report
- Server IP and ID
- Firewall ID
- Health-check result
- Service status (active/failed)
- Sendblue webhook re-pointed (yes/no)
