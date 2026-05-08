# Deploy latest Boop changes to production

Pull the latest pushed code on the Boop server and restart the service. Use this once code is committed and pushed to your fork — it does not commit/push for you.

**Arguments:** $ARGUMENTS (optional: `deps` to force `npm install`, `convex` to force `npx convex deploy`, `all` for both)

---

## Prereqs

- The Boop server exists (`hcloud server describe boop`)
- The Cloudflare A record `boop.planforadventure.com` resolves to the server IP
- You're on a branch whose `HEAD` is what you want to ship

## Steps

### 1. Verify the working tree is clean and pushed
```bash
git status --porcelain && git rev-parse HEAD && git log @{u}..HEAD --oneline
```
If there are uncommitted changes or unpushed commits, **stop** — commit/push first.

### 2. Pull on the server
```bash
BOOP_IP=$(hcloud server describe boop -o format='{{.PublicNet.IPv4.IP}}')
ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "cd /opt/boop/repo && sudo -u boop git pull"    # BOOP-OK
```

### 3. Conditional updates

- **Dependencies** (if `package.json`/`package-lock.json` changed, or `$ARGUMENTS` includes `deps`/`all`):
  ```bash
  ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "cd /opt/boop/repo && sudo -u boop npm install"    # BOOP-OK
  ```

- **Convex schema/functions** (if `convex/` changed, or `$ARGUMENTS` includes `convex`/`all`):
  ```bash
  ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "cd /opt/boop/repo && sudo -u boop bash -c 'npx convex deploy'"    # BOOP-OK
  ```

### 4. Restart the service
```bash
ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "systemctl restart boop"    # BOOP-OK
```

### 5. Verify
```bash
curl -fsS https://boop.planforadventure.com/health || echo "HEALTH FAILED"
ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "systemctl is-active boop && journalctl -u boop --no-pager -n 20"    # BOOP-OK
```

If health fails, immediately:
```bash
ssh -i ~/.ssh/boop_deploy root@$BOOP_IP "journalctl -u boop --no-pager -n 80"    # BOOP-OK
```

## Report
- Commit hash deployed
- What was rebuilt (deps / convex / both / neither)
- Health check
- Service status
