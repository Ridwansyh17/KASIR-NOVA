# ============================================================================
# KASIR NOVA - Container image backend untuk Cloud Run
# ============================================================================
# Multi-stage: instal hanya dependencies produksi, lalu salin ke image rampung.
# Image berjalan sebagai user non-root (keamanan).

# ---- Stage 1: dependencies produksi ---------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Salin manifest dulu agar layer cache bekerja.
# (Workspaces npm memakai lock tunggal di root; server/ tidak punya lock sendiri.)
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# npm workspaces: instal dependency server (hoisting ke root node_modules).
RUN npm ci --workspace @nova/server --omit=dev --ignore-scripts

# ---- Stage 2: image runtime -----------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Dependencies hasil build (sudah bersih dari devDependencies).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules

# Hanya kode server. Folder apps/ TIDAK disertakan: di produksi Express
# berhenti menyajikan file statis (lihat src/app.js) — frontend disajikan
# Firebase Hosting.
COPY server/package.json ./server/
COPY server/src ./server/src

# User non-root (rootless container).
RUN groupadd --system nova && useradd --system --gid nova nova
RUN chown -R nova:nova /app
USER nova

# Cloud Run menyuntikkan PORT; server membaca env PORT.
EXPOSE 4000

# Migration & seed dijalankan terpisah (lihat cloudbuild.yaml), bukan saat
# startup, agar rollout tidak diblokir oleh DB.
CMD ["node", "server/src/server.js"]
