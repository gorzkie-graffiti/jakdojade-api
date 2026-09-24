# Deploying the transit API

Live at **http://34.61.173.205:5000** (GCP VM, hostname `j2me-server`, user
`mateusz_pierzchala2005`). It runs next to the unrelated Next.js Ember app on
port 3000 and does not touch it.

## Why port 5000

The instance's GCP firewall only exposes **22, 80, 3000 and 5000**
(443, 3001, 8000, 8080 and 9000 are dropped). 80 would need root; 3000 is taken
by the Ember app. 5000 is unprivileged and open, so the API binds there without
`sudo` and without any firewall change.

Runtimes are not on `PATH` for non-login shells on this box:
`~/.nvm/versions/node/v20.20.2/bin/node` (v20.20.2) and `~/.bun/bin/bun`.

## What is deployed

| Path on the VM | Contents |
|---|---|
| `~/transit-api/` | this repo: `src/` (Jakdojade client), `server/` (the API), `ember-midlet/` (MIDlet sources), `deploy/` |
| `~/transit-api/download/` | `Ember.jar` + `Ember.jad`, served over the air |
| `~/transit-api/transit-api.log` | service log |

The service is a plain detached process plus a `@reboot` crontab entry — no
`sudo` anywhere:

```
@reboot cd $HOME/transit-api && setsid nohup ./deploy/run.sh >/dev/null 2>&1 < /dev/null &
```

`deploy/transit-api.service` is provided for when you would rather run it under
systemd; installing that one *does* need `sudo`.

## Deploy / redeploy

```sh
# from the repo root
chmod +x deploy/run.sh
tar czf - --exclude=./node_modules --exclude=./.git . \
  | ssh mateusz_pierzchala2005@34.61.173.205 'tar xzf - -C ~/transit-api'

# dependencies (node must be on PATH for npm's shebang)
ssh mateusz_pierzchala2005@34.61.173.205 \
  'export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; \
   cd ~/transit-api && npm install --omit=dev --no-audit --no-fund'

# restart
ssh mateusz_pierzchala2005@34.61.173.205 \
  'pids=$(pgrep -f "[s]erver/index\.js"); [ -n "$pids" ] && kill $pids; sleep 2; \
   cd ~/transit-api && (setsid nohup ./deploy/run.sh >/dev/null 2>&1 </dev/null &)'

# verify
curl -s http://34.61.173.205:5000/api/health
```

## Configuration

Environment variables read by `deploy/run.sh` (all overridable per request by
query parameter where it makes sense):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | listen port |
| `CITY_SYMBOL` | `WARSZAWA` | default Jakdojade city; `?city=LODZ`, `PABILLANCE`… see below |
| `DEFAULT_FROM` | `Plac Defilad 1` | origin used when the query names only a destination |
| `MAX_ROUTES` | `8` | routes per response (the legacy protocol limit) |
| `MAP_JPEG_QUALITY` | `70` | map JPEG quality |
| `SEARCH_CACHE_MS` | `45000` | result cache for identical queries |
| `LAST_RESULT_MS` | `600000` | how long `/v/map` may reuse the last search |

Valid city symbols confirmed upstream: `WARSZAWA`, `LODZ`, `PABIANICE`
(`LODZ_PABIANICE` returns HTTP 400). Queries mentioning Pabianice or Łódź are
auto-routed to `PABIANICE`/`LODZ`, so `z Dworca Fabrycznego do Pabianic` works
without a `city` parameter.

## Logs and health

```sh
ssh mateusz_pierzchala2005@34.61.173.205 'tail -f ~/transit-api/transit-api.log'
curl -s http://34.61.173.205:5000/api/health
```

## Rollback

```sh
ssh mateusz_pierzchala2005@34.61.173.205 \
  'pids=$(pgrep -f "[s]erver/index\.js"); [ -n "$pids" ] && kill $pids; crontab -l | grep -v transit-api | crontab -'
rm -rf ~/transit-api   # optional
```

Nothing in `~/ember` (the Next.js app or its `EmberVeer` MIDlet) is modified by
this deployment.
