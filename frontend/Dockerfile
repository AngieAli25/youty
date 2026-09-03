# Immagine unica per entrambe le SPA: si sceglie con l'argomento di build APP.
#   APP=dashboard    → gestionale salone (staff)
#   APP=client-app   → web app cliente
# Build context: la cartella `frontend/`.
#
# ATTENZIONE: Vite inlina le variabili VITE_* nel bundle a build time.
# Non sono configurabili a runtime: cambiarle richiede un nuovo build.
ARG APP=dashboard

# ---------- build ----------
FROM node:22-alpine AS build
ARG APP
ARG VITE_API_URL
ARG VITE_SALON_SLUG
ARG VITE_CLIENT_APP_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SALON_SLUG=$VITE_SALON_SLUG \
    VITE_CLIENT_APP_URL=$VITE_CLIENT_APP_URL

# Senza questo il bundle punterebbe silenziosamente a http://localhost:8000 (default di api.js)
RUN test -n "$VITE_API_URL" || { \
      echo "ERRORE: build arg VITE_API_URL mancante — il frontend punterebbe a localhost."; \
      exit 1; }

WORKDIR /repo

# Layer di dipendenze separato: cambia solo quando cambiano i package.json
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/client-app/package.json apps/client-app/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build --workspace apps/$APP

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime
ARG APP
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/$APP/dist /usr/share/nginx/html
EXPOSE 80
