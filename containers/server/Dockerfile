# Image de RedWidow Serveur (ADR 0052, point 7). À construire depuis la racine du dépôt :
#   docker build -f containers/server/Dockerfile -t redwidow .
# Aucune clé dans l'image : tout passe par l'environnement au lancement (voir .env.example).
ARG NODE_IMAGE=node:22-bookworm-slim
ARG DOCKER_CLI_IMAGE=docker:27-cli

# Client Docker statique (le serveur pilote les conteneurs Kali par le socket de l'hôte).
FROM ${DOCKER_CLI_IMAGE} AS dockercli

# Exegol (CLI Python) installé dans un venv dédié, copié ensuite dans l'image runtime (pas de pip ni de
# compilateur au runtime). Version EXACTE, publiée sur PyPI depuis plus de 14 jours : à relever à la main.
FROM ${NODE_IMAGE} AS exegol
ARG EXEGOL_VERSION=6.0.2
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/exegol \
    && /opt/exegol/bin/pip install --no-cache-dir "exegol==${EXEGOL_VERSION}" \
    && find /opt/exegol -name __pycache__ -type d -prune -exec rm -rf {} + \
    && rm -rf /opt/exegol/lib/python3*/site-packages/pip* /opt/exegol/bin/pip*

FROM ${NODE_IMAGE} AS build
WORKDIR /src
# pnpm via corepack, à la version épinglée par le champ packageManager de la racine.
COPY package.json ./
RUN corepack enable && corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Moteur bundlé (empreintes des binaires embarquées) : packages/server/engine/{run-engine.mjs,bin/}.
RUN node packages/server/scripts/bundle-engine.mjs
# Paquet serveur seul, dépendances de production (copie autonome, sans les sources des autres paquets).
RUN pnpm --filter @warband/server deploy --prod --legacy /out \
    && rm -rf /out/engine /out/src /out/test /out/scripts \
    # Les binaires claude et opencode sont déjà dans le moteur bundlé (empreinte vérifiée) : on
    # retire leurs copies natives des dépendances (~680 Mo) ; le serveur ne les lance pas lui-même.
    && rm -rf /out/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-* \
              /out/node_modules/.pnpm/opencode-*

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    REDWIDOW_HOST=0.0.0.0 \
    REDWIDOW_PORT=8080 \
    REDWIDOW_DATA_DIR=/data \
    REDWIDOW_ENGINE=/app/engine/run-engine.mjs \
    REDWIDOW_BIN_ROOT=/app/engine \
    HOME=/data/home \
    XDG_CONFIG_HOME=/data/config
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates python3 git \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 redwidow \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /data/home --shell /usr/sbin/nologin redwidow \
    && mkdir -p /data/home /data/config \
    && chown -R 10001:10001 /data \
    && chmod 700 /data
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# Exegol : le serveur lance la CLI `exegol` (création des conteneurs depuis le cockpit). Aucune clé ni
# licence dans l'image ; la configuration est écrite sous HOME (/data/home) au premier lancement.
COPY --from=exegol /opt/exegol /opt/exegol
RUN ln -s /opt/exegol/bin/exegol /usr/local/bin/exegol
WORKDIR /app
# Même position relative qu'en dépôt : /media lit ../../vscode/media depuis packages/server/dist.
COPY --from=build /out ./packages/server
COPY --from=build /src/packages/vscode/media ./packages/vscode/media
COPY --from=build /src/packages/server/engine ./engine
VOLUME /data
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.REDWIDOW_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/server/dist/main.js", "serve"]
