# node:22 (full ICU), not node:22-slim/alpine — the Jalali calendar (Intl locale
# "fa-IR-u-ca-persian") needs full ICU data; slim/alpine ship small-icu and would silently
# fall back to the Gregorian calendar. Also: better-sqlite3 requires Node >=22. See
# lib/intl/jalali.ts's icuSmokeTest(), which logs a loud warning at boot if ICU regresses.
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22
# node:22 already ships a uid-1000 "node" user (unlike python:3.13-slim, which needed one
# created) — reuse it instead of useradd'ing a second uid-1000 account, which errors.
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/app ./app
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
RUN mkdir /data && chown node /data
# renderImage()/analyze() (lib/tools.ts) need a real Chromium — the server has no system
# Chrome like the dev Mac does, so install Playwright's own + its OS deps as root.
RUN npx playwright install --with-deps chromium
USER node
ENV HUB_DATA=/data HUB_BIND=0.0.0.0 HUB_PORT=4500 NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:4500/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
EXPOSE 4500
CMD ["npx", "tsx", "server.ts"]
