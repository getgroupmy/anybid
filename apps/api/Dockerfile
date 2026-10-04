# AnyBid API — built from the repository root, because the service depends on
# the @anybid/shared workspace package.
#
#   docker build -f apps/api/Dockerfile -t anybid-api .
#
# Works unchanged on Fly.io, Railway, Render or any container host.

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Manifests first so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# The web and mobile workspaces are declared in the root manifest. npm tolerates
# their directories being absent, and omitting them keeps the image small.
RUN npm ci --ignore-scripts

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @anybid/shared \
    && npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npx tsc -p apps/api/tsconfig.json

# Drop dev dependencies from the tree that ships.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
# Kept for `prisma migrate deploy` on release.
COPY --from=build /repo/apps/api/prisma apps/api/prisma

# Never run as root.
USER node

EXPOSE 4000
ENV API_HOST=0.0.0.0 API_PORT=4000

# Which commit this image was built from, reported by /health. Last, so it
# does not invalidate the layers above on every build. Empty when the image is
# built by hand, which /health reports as "unknown" rather than guessing.
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

# The API and the settlement worker share this image; the platform picks which
# to run. Exactly one process must have the settlement loop enabled.
CMD ["node", "apps/api/dist/src/server.js"]
