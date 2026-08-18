# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Étape 1 : dépendances complètes et compilation.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Les manifestes d'abord : le cache de couches survit aux modifications de code.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci --no-audit --fund=false

COPY packages ./packages
RUN npm run build

# On élague les dépendances de développement après la compilation : l'image
# finale n'embarque ni TypeScript, ni Vite, ni Vitest.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Étape 2 : image d'exécution.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# `dumb-init` traite correctement les signaux : sans lui, SIGTERM n'atteint pas
# toujours le processus Node et Coolify attend l'expiration du délai à chaque
# redéploiement.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/neon-pong.db \
    PUBLIC_DIR=/app/packages/client/dist \
    NODE_OPTIONS=--max-old-space-size=192

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist

# Le volume de données appartient à l'utilisateur non privilégié qui exécute Node.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3000

# La sonde tape la route dédiée : elle ne touche pas au disque, un pic d'entrées
# / sorties ne doit pas faire redémarrer un conteneur en bonne santé.
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/server/dist/index.js"]
