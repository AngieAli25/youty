# Deploy su Coolify

## Architettura

Quattro risorse Coolify, tutte dallo stesso repository:

| Risorsa | Tipo | Dominio | Build context | Porta |
|---|---|---|---|---|
| `beauty-db` | Database PostgreSQL | — (interno) | — | 5432 |
| `beauty-api` | Application · Dockerfile | `beautyapi.yourang.ai` | `/backend` | 8000 |
| `beauty-dashboard` | Application · Dockerfile | `beauty.yourang.ai` | `/frontend` | 80 |
| `beauty-client` | Application · Dockerfile | `beautyclients.yourang.ai` | `/frontend` | 80 |

Le due SPA sono file statici serviti da nginx: chiamano l'API in cross-origin, per
questo il backend ha un dominio suo (che ospita anche `/admin`).

**L'app cliente serve tutti i saloni con un solo deploy**: lo slug è il primo
segmento del path (`beautyclients.yourang.ai/the-parlour` → salone `the-parlour`),
vedi `resolveSalonSlug()` in `frontend/packages/shared/src/salon.js`.

Non c'è **nessun passo** da fare quando arriva un salone nuovo: creato in admin, il
suo URL funziona subito. Un dominio, un certificato, per sempre.

## Prerequisiti

- Un server con Coolify installato e il suo IP pubblico.
- Accesso al DNS di `yourang.ai`.
- Il repo `SoftBoom-SRL/beauty` collegato a Coolify (GitHub App o deploy key).

## 1. DNS

Due record A nella zona `yourang.ai`, entrambi verso l'IP del server Coolify
(`coolify-v1` su Hetzner, **91.99.117.151**):

```
beauty          A   91.99.117.151     dashboard staff
beautyapi       A   91.99.117.151     backend + admin
beautyclients   A   91.99.117.151     app cliente (tutti i saloni)
```

Nessun wildcard: i saloni stanno nel path, non nell'host. Se avevi già creato
`*.beautyclients`, puoi rimuoverlo.

> **Porta 80 filtrata su questo server** (verificato il 31/07/2026: 443 raggiungibile,
> 80 droppata a monte). Due conseguenze:
> - I certificati Let's Encrypt **non** possono usare la challenge HTTP-01. Il proxy
>   Coolify usa TLS-ALPN-01 sulla 443: l'emissione funziona (verificata su tutti e
>   tre gli host).
> - **Non esiste il redirect http→https.** Un link scritto `http://...` non risponde.
>   Tutti i link ai saloni condivisi con le clienti (WhatsApp, QR, biglietti da
>   visita) devono essere `https://` espliciti.
>
> È un limite del server, non di questo progetto: va risolto con un ticket a Hetzner.

## 2. Database

Coolify → **+ New** → **Database** → **PostgreSQL 16**. Nome `beauty-db`.

Dopo il deploy copia la **Postgres URL (internal)**: serve al backend. Ha la forma
`postgres://postgres:<password>@<host-interno>:5432/postgres`.

Attiva i backup pianificati nella tab **Backups** della risorsa.

## 3. Backend (`beauty-api`)

**+ New → Application → Public/Private Repository**, repo `SoftBoom-SRL/beauty`,
branch `main`, **Build Pack: Dockerfile**.

Configurazione:

| Campo | Valore |
|---|---|
| Base Directory | `/backend` |
| Dockerfile Location | `/Dockerfile` (se Coolify lo vuole relativo alla root: `/backend/Dockerfile`) |
| Ports Exposes | `8000` |
| Domains | `https://beautyapi.yourang.ai` |
| Health Check Path | `/healthz` |

**Storage persistente** (tab *Storages* → *Add volume mount*), altrimenti gli upload
spariscono a ogni redeploy:

| Name | Destination Path |
|---|---|
| `beauty-media` | `/app/media` |

**Environment variables** — nessuna va marcata come *Build Variable*:

```
SECRET_KEY=<genera: openssl rand -base64 48>
DEBUG=0
DATABASE_URL=<Postgres URL interna dal punto 2>
ALLOWED_HOSTS=beautyapi.yourang.ai
CSRF_TRUSTED_ORIGINS=https://beautyapi.yourang.ai
CORS_ALLOWED_ORIGINS=https://beauty.yourang.ai,https://beautyclients.yourang.ai
FRONTEND_ORIGIN=https://beauty.yourang.ai
ENCRYPTION_KEY=<genera: openssl rand -hex 32>
DJANGO_SUPERUSER_EMAIL=tu@yourang.ai
DJANGO_SUPERUSER_PASSWORD=<password forte>

YOURANG_ISSUER_URL=https://api.yourang.ai
YOURANG_CLIENT_ID=<dal provisioning Yourang>
YOURANG_CLIENT_SECRET=<dal provisioning Yourang>
YOURANG_WEBHOOK_RECEIVER_URL=https://beautyapi.yourang.ai/api/integrations/yourang/webhook
```

Le quattro `YOURANG_*` servono al login con account Yourang e al sync fra i due
portali: senza `YOURANG_ISSUER_URL` e `YOURANG_CLIENT_ID` gli endpoint OAuth
rispondono `503 Integrazione Yourang non configurata` e il pulsante nella pagina
di login va in errore. Vedi §8 per il redirect_uri da far whitelistare.

`FRONTEND_ORIGIN` non è cosmetica: `client.py::redirect_uri()` la usa per costruire
`<FRONTEND_ORIGIN>/oauth-popup/done`. Se non combacia con la whitelist lato Yourang,
l'authorization server rifiuta la richiesta.

`ENCRYPTION_KEY` diventa obbligatoria con l'integrazione attiva: i token OAuth sono
cifrati a riposo (AES-256-GCM) e senza chiave lo scambio solleva un errore.

Opzionali, da aggiungere quando servono:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

`entrypoint.sh` esegue `migrate` e `collectstatic` a ogni avvio, e crea il superuser
al primo (poi lo salta). Dopo il primo deploy **rimuovi `DJANGO_SUPERUSER_PASSWORD`**
dalle env: non serve più.

Deploy → verifica `https://beautyapi.yourang.ai/healthz`, `/api/docs` e il login su `/admin/`.

## 4. Dashboard staff (`beauty-dashboard`)

Stessa procedura, **Build Pack: Dockerfile**:

| Campo | Valore |
|---|---|
| Base Directory | `/frontend` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `80` |
| Domains | `https://beauty.yourang.ai` |

Environment variables — **tutte marcate come Build Variable** (la spunta
*Build Variable?* accanto a ogni variabile). Vite le inlina nel bundle a build time:
se le lasci come env di runtime il container parte ma il bundle punta a localhost.

```
APP=dashboard
VITE_API_URL=https://beautyapi.yourang.ai
VITE_CLIENT_APP_URL=https://beautyclients.yourang.ai
```

`VITE_CLIENT_APP_URL` serve a *Impostazioni → Link pubblici*, dove la titolare
copia i propri URL (app cliente e modulo contatti). La dashboard sta su un altro
dominio e non può dedurlo. Se manca, quella sezione non compare.

Il Dockerfile fallisce apposta se `VITE_API_URL` manca, così non ti ritrovi in
produzione un frontend che chiama `http://localhost:8000`.

## 5. App cliente (`beauty-client`)

| Campo | Valore |
|---|---|
| Base Directory | `/frontend` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `80` |
| Domains | `https://beautyclients.yourang.ai` |

Build Variables:

```
APP=client-app
VITE_API_URL=https://beautyapi.yourang.ai
```

Un solo dominio per tutti i saloni. `VITE_SALON_SLUG` non serve in produzione:
resta solo come fallback per lo sviluppo locale, dove non c'è slug nel path.

### Aggiungere un salone

Crealo in `/admin/` (o dalla dashboard) con lo slug che vuoi, es. `bellezza-mia`.
Il suo URL — `https://beautyclients.yourang.ai/bellezza-mia` — è già attivo.

Niente DNS, niente domini in Coolify, niente rebuild, niente certificati. Era
esattamente il passo manuale che questa scelta elimina.

### Sessioni

Tutti i saloni condividono l'origin, quindi il localStorage. La chiave di sessione
è namespacizzata per slug (`yt.client.session:<slug>`, vedi `clientAuth.js`):
una cliente che apre due saloni diversi non si porta dietro il token sbagliato.

## 6. Verifica

- `https://beautyapi.yourang.ai/healthz` → `{"status": "ok"}`
- `https://beautyapi.yourang.ai/admin/` → login funzionante **con il CSS al suo posto**
  (se l'admin è senza stile, whitenoise non sta servendo `/static/`)
- `https://beauty.yourang.ai` → pagina di login staff, nessun errore CORS in console
- `https://beautyclients.yourang.ai/the-parlour` → branding del salone caricato
  (se vedi un errore, il salone con quello slug non esiste nel database)
- Carica un logo da *Impostazioni → Brand*, poi ricarica l'app cliente: se il logo
  appare, il volume dei media e la rotta `/media/` funzionano.

## 7. Dati iniziali

Il database parte vuoto: il primo salone lo crei da `/admin/` (Saloni → Aggiungi),
poi Sede, Impostazioni e la Membership che collega il tuo utente al salone.

Per popolare invece un salone demo completo (The Parlour, 9 operatrici, 14 servizi,
10 clienti, appuntamenti di oggi — login `sole@theparlour.it` / `theparlour`), dal
terminale del container `beauty-api`:

```bash
python manage.py seed_demo
```

È scoped allo slug `the-parlour` e non tocca gli altri saloni: puoi tenerlo accanto
ai dati reali e rimuoverlo dopo. `--reset` lo ricrea da zero.

## 8. Integrazioni

**Stripe** — endpoint webhook: `https://beautyapi.yourang.ai/api/sales/stripe/webhook`.
Senza `STRIPE_SECRET_KEY` gli endpoint di pagamento rispondono 503, il resto funziona.

**Yourang OAuth** — abilita sia il "login con Yourang" dalla pagina di login (che
provisiona/collega il salone e conia la sessione staff) sia il "collega" dalle
impostazioni, seguito dal primo sync di contatti e servizi.

Da fare **lato Yourang**, una volta sola:

1. Provisionare il client OAuth e prendere `client_id` / `client_secret`.
2. Whitelistare il redirect_uri **esatto**: `https://beauty.yourang.ai/oauth-popup/done`.

Verificato il 31/07/2026 su `https://api.yourang.ai/.well-known/openid-configuration`:
l'issuer è `https://api.yourang.ai`, ma l'`authorization_endpoint` sta su
`https://app.yourang.ai/oauth/authorize`. Il codice legge gli endpoint dal documento
di discovery invece di derivarli dall'issuer, quindi funziona — ma non provare a
ricostruirli a mano. Tutti gli scope richiesti da `client.py::SCOPES` (`openid
profile email offline_access contacts:read contacts:write events:read`) risultano
supportati dall'authorization server.

Il webhook in ingresso (`YOURANG_WEBHOOK_RECEIVER_URL`) viene registrato in
automatico durante lo scambio del code. Se lo ometti la connessione riesce lo
stesso, ma Yourang non spinge eventi: il sync resta quello iniziale.

**Outbox** — gli eventi verso Yourang si accodano in `core_outboxevent`.
Per svuotarli serve un job schedulato (Coolify → *Scheduled Tasks* sulla risorsa
`beauty-api`), comando `python manage.py flush_outbox`.

## Note

- Cambiare `VITE_API_URL` richiede un **redeploy con rebuild** del frontend
  interessato: è una costante compilata nel bundle.
- `/media/` è servito da Django (`config/urls.py`). Va benissimo per logo e foto di
  un salone; se un giorno il volume di upload cresce, sposta i media su S3 e metti
  `SERVE_MEDIA=0`.
- I `.jsx` nella root del repo sono il prototipo Babel-standalone originale: non
  fanno parte del deploy, il codice vivo è sotto `frontend/`.
