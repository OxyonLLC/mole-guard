# Mole Guard Docker Dev Setup

This Docker setup is for running the same command you already use locally:

```bash
npm run dev:all
```

The container runs that command for you through Docker Compose.

## What this adds

- Root `Dockerfile` for the full Mole Guard / WinLEW dev environment.
- `docker-compose.yml` for one-command startup.
- `.dockerignore` so secrets, runtime JSON, and `node_modules` are not baked into the image.
- `docker/entrypoint.sh` to create runtime data folders and install dependencies if the mounted `node_modules` volume is empty.
- Docker-safe host binding for:
  - Mole web/API: `PORT`, default `8787`
  - Public server: `PUBLIC_PORT`, default `8788`
  - Watchdog: `WATCHDOG_PORT`, default `8790`
- Optional `NGROK_ENABLED=false` mode so Docker can run local-only without failing if ngrok is not wanted.

## First run on the second PC

From the project root:

```bash
docker compose up --build
```

Then open:

- Mole / API: `http://localhost:8787`
- WinLEW Forge helper server: `http://localhost:8788`
- Watchdog: `http://localhost:8790`

Use `8787` for the main WinLEW site (`/faucet/`, `/quiz/`, `/verify/`, etc.). Port `8788`
is intentionally scoped to the Forge helper server so Docker does not expose a second copy of
the site on a different port.

## Local-only mode without ngrok

Bash / WSL:

```bash
NGROK_ENABLED=false docker compose up --build
```

PowerShell:

```powershell
$env:NGROK_ENABLED="false"
docker compose up --build
```

## Run an interactive Docker shell

```bash
docker compose run --rm moleguard bash
```

Inside the container, you can manually run:

```bash
npm run dev:all
```

## Rebuild clean if dependencies get weird

```bash
docker compose down -v
docker compose up --build
```

## Notes

- Keep your real `.env`, `src/faucet/.env`, and `src/quiz/.env` on the host machine. Compose injects them at runtime.
- Runtime data stays on the host through bind mounts, so JSON state does not disappear when the container is rebuilt.
- The old `src/faucet/Dockerfile` can remain. The new root `Dockerfile` is the one used for `npm run dev:all`.
