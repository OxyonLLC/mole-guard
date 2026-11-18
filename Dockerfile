# Mole Guard / WinLEW all-in-one dev container
# Runs the same root command you use locally: yarn dev:all
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=development

# Base tools:
# - curl/ca-certificates for installing ngrok
# - git/procps for common Node tooling/debugging
# - bash for an easy shell inside the container
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git procps \
  && rm -rf /var/lib/apt/lists/*

# Install ngrok CLI because src/scripts/dev-all.js starts `ngrok http ...`.
# Supports common Docker platforms used by Windows/macOS/Linux Docker Desktop.
ARG TARGETARCH=amd64
RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) NGROK_ARCH="amd64" ;; \
    arm64) NGROK_ARCH="arm64" ;; \
    *) echo "Unsupported architecture for ngrok: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${NGROK_ARCH}.tgz" \
    | tar -xz -C /usr/local/bin; \
  ngrok version

# Install dependencies from the root npm lock.
# npm ci refuses to run here: package-lock.json is missing an optional
# transitive dep (utf-8-validate), so it's out of sync even on a clean
# checkout. npm install tolerates that; see the repo owner about
# regenerating the lockfile properly.
COPY package.json package-lock.json ./
RUN npm install

# Copy source after deps so Docker can cache installs. Secrets and runtime data are
# intentionally excluded by .dockerignore and mounted at runtime by docker-compose.
COPY . .

COPY docker/entrypoint.sh /usr/local/bin/moleguard-entrypoint
RUN chmod +x /usr/local/bin/moleguard-entrypoint

EXPOSE 8787 8788 8790

ENTRYPOINT ["moleguard-entrypoint"]
CMD ["npm", "run", "dev:all"]
