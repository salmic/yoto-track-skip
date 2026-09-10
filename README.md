# Yoto Track Skip

Auto-skip pre-configured tracks on Yoto cards. Configure skip lists in a local web UI; a background service monitors your Yoto players and jumps past selected tracks when a card plays — including physical card inserts.

## Features

- Per-card skip profiles with chapter/track picker
- Always-on background service with MQTT playback monitoring
- Multi-device support (one profile applies to all household players)
- Activity log of recent auto-skips
- Windows service installer script

## Prerequisites

1. [Node.js 20+](https://nodejs.org/)
2. A [Yoto developer app](https://yoto.dev/) with `YOTO_CLIENT_ID` (and optional `YOTO_CLIENT_SECRET`)
3. Yoto player(s) linked to your Yoto account

## Setup

```powershell
# Install dependencies
npm install
npm install --prefix web

# Configure credentials
copy .env.example .env
# Edit .env and set YOTO_CLIENT_ID

# Development
npm run dev          # API + skip engine on http://localhost:3847
npm run dev:web      # Frontend dev server on http://localhost:5173 (proxies /api)

# Production build
npm run build
npm start
```

Open http://localhost:3847 (or http://localhost:5173 during frontend dev), connect your Yoto account, and add skip profiles for your cards.

## How it works

1. You sign in with Yoto OAuth (browser PKCE flow).
2. The service connects to your players via MQTT and listens for track-change events.
3. When a configured track starts playing, the service sends `card/start` to jump to the next non-skipped track.
4. Skip profiles are stored locally in SQLite (`data/skip.db`) using Node's built-in `node:sqlite` module.

## Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/salmic/yoto-track-skip)

1. Create a new Railway project from this repo (or click the button above).
2. Add these **variables** in Railway → your service → Variables:
   - `YOTO_CLIENT_ID` — your Yoto developer client ID
   - `YOTO_CLIENT_SECRET` — leave empty unless your Yoto app requires it
3. Add a **volume** mounted at `/data` so skip profiles and login tokens survive redeploys:
   - Railway → your service → Settings → Volumes → Add volume
   - Mount path: `/data`
   - Variable: `DATA_DIR=/data`
4. Generate a public domain: Railway → Settings → Networking → Generate domain.
5. In your [Yoto developer app](https://yoto.dev/), add this **redirect URI** (use your Railway domain):
   ```
   https://YOUR-RAILWAY-DOMAIN/login
   ```
   `PUBLIC_BASE_URL` is auto-detected from `RAILWAY_PUBLIC_DOMAIN`; override it only if you use a custom domain.
6. Deploy. Open your Railway URL, sign in with Yoto, and configure skip profiles.

The Dockerfile builds the API and web UI. Railway sets `PORT` automatically; the health check uses `/api/health`.

## Windows service (always-on)

Build first, then install as a Windows service with NSSM:

```powershell
npm run build
.\scripts\install-service.ps1
```

Download [NSSM](https://nssm.cc/) and place `nssm.exe` in `tools\nssm.exe`, or install it globally.

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/auth/status` | Login state |
| POST | `/api/auth/login` | Start OAuth PKCE flow (returns auth URL) |
| POST | `/api/auth/callback` | Complete OAuth after redirect |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/devices` | List players + MQTT status |
| GET | `/api/cards` | User card library |
| GET | `/api/cards/:cardId/content` | Card chapters/tracks |
| GET/PUT/DELETE | `/api/profiles/:cardId` | Skip profile CRUD |
| PATCH | `/api/profiles/:cardId/toggle` | Enable/disable profile |
| GET | `/api/activity` | Recent auto-skips |

## Testing

```powershell
npm test
```

Unit and integration tests cover track navigation, skip engine behavior, and the configure → playback → auto-skip flow (simulated, no live player required).

## Manual end-to-end test

1. Start the app and connect your Yoto account.
2. Create a skip profile for a card you have physically available.
3. Insert the card on a Yoto player.
4. Confirm skipped tracks are jumped automatically and appear in the activity log.

## License

MIT
