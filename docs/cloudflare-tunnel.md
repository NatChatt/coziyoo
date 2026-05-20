# Cloudflare Tunnel for Live API

This is the current live API setup for `api.coziyoo.com`.

## Current Routing

```text
Mobile app / browser
  -> https://api.coziyoo.com
  -> Cloudflare DNS + Cloudflare Tunnel
  -> this Mac, cloudflared LaunchAgent
  -> http://127.0.0.1:9000
  -> Django API
  -> Supabase PostgreSQL
```

Supabase is the database. Cloudflare is only the public HTTPS ingress. The mobile app should use `https://api.coziyoo.com` as its API URL.

## No VPN

This setup does not use VPN, WireGuard, Tailscale, ZeroTier, or Cloudflare private-network routing.

The tunnel only publishes specific HTTPS hostnames:

```text
api.coziyoo.com
admin.coziyoo.com
```

It does not route private IP ranges, expose the local network, or require a VPN client on the phone or laptop.

Verification command:

```bash
cloudflared tunnel route ip show
```

Expected result:

```text
No routes were found for the given filter flags.
```

## Domain and DNS

The domain remains registered at Namecheap. Namecheap is still the registrar and renewals stay there.

DNS is managed in Cloudflare for the `coziyoo.com` zone.

Cloudflare nameservers:

```text
bruce.ns.cloudflare.com
meera.ns.cloudflare.com
```

Tunnel DNS route:

```text
api.coziyoo.com -> coziyoo-api Cloudflare Tunnel
admin.coziyoo.com -> coziyoo-api Cloudflare Tunnel
```

## Tunnel Details

Tunnel name:

```text
coziyoo-api
```

Tunnel ID:

```text
1b2583b4-78ec-40a3-85a9-7af141e27450
```

Local config:

```text
~/.cloudflared/config.yml
```

Expected config shape:

```yaml
tunnel: 1b2583b4-78ec-40a3-85a9-7af141e27450
credentials-file: /Users/ismetkarakus/.cloudflared/1b2583b4-78ec-40a3-85a9-7af141e27450.json

ingress:
  - hostname: api.coziyoo.com
    service: http://127.0.0.1:9000
  - hostname: admin.coziyoo.com
    service: http://127.0.0.1:9000
  - service: http_status:404
```

Do not commit `~/.cloudflared/*.json` or `~/.cloudflared/cert.pem`. They are credentials.

## Local Services Required

For `https://api.coziyoo.com` to work, both of these must be running on this Mac:

1. Django on port `9000`
2. `cloudflared` tunnel agent

Django should be reachable locally:

```bash
curl -fsS http://127.0.0.1:9000/v1/health/
```

The live API should be reachable publicly:

```bash
curl -fsS https://api.coziyoo.com/v1/health/
```

The live admin should redirect to Django admin login:

```bash
curl -I https://admin.coziyoo.com/admin/
```

Expected response:

```json
{"status":"ok","db":"ok","cache":"ok"}
```

## Start and Check Commands

Check everything:

```bash
bash scripts/deploy/check-live-api.sh
```

Start the Cloudflare tunnel LaunchAgent if needed:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coziyoo.cloudflared.plist
```

Check LaunchAgent state:

```bash
launchctl print gui/$(id -u)/com.coziyoo.cloudflared
```

Stop the LaunchAgent:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.coziyoo.cloudflared.plist
```

Run tunnel manually for debugging:

```bash
cloudflared tunnel run coziyoo-api
```

Logs:

```text
~/Library/Logs/coziyoo-cloudflared.err.log
~/Library/Logs/coziyoo-cloudflared.out.log
```

## Mobile App

`apps/mobile/.env` should use:

```text
EXPO_PUBLIC_API_URL=https://api.coziyoo.com
```

This lets the app work from home, work, or any outside network, as long as this Mac, Django, and the Cloudflare tunnel are running.
