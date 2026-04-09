# Qusicians Backend

Node.js backend for Qusicians, a collaborative Spotify session app with a server-authoritative queue model.

## Current Architecture

The backend is responsible for:

- Spotify OAuth for the host account
- Redis-backed host and guest session state
- Credit enforcement for guests, with host bypass
- Server-owned pending and confirmed queue state
- Periodic batch flush of pending tracks into the host playlist
- Periodic Spotify queue reconciliation
- Websocket fan-out of queue snapshots to all connected clients
- Centralized Spotify upstream protection for search, queue reads, and playlist writes

Spotify remains the canonical persistence layer, but the backend is the operational truth layer distributed to clients.

## Runtime Model

The queue flow is:

1. Guest requests a song
2. Backend validates credits and stores the track in `pendingTracks`
3. Frontend shows the pending item immediately
4. Realtime refresh loop flushes pending tracks to the playlist in batches
5. Backend fetches the latest Spotify playback queue
6. Backend emits one shared snapshot to all connected clients
7. Frontend removes pending items only when they appear in confirmed state

This avoids per-client Spotify polling and reduces playlist write amplification.

## Spotify Protection Layer

All Spotify HTTP traffic now routes through a centralized gateway.

The gateway currently provides:

- single request path for Spotify API calls
- request priority (`high`, `normal`, `low`)
- conservative request spacing
- retry-on-`429`
- queue depth and duration logging

Search additionally has:

- query normalization
- in-memory TTL cache
- in-flight dedupe for identical concurrent searches

This is intentionally in-memory because the current deployment target is a single backend instance.

## Service Boundaries

- `controllers/` orchestrate HTTP concerns only
- `services/` own business logic and external API interaction
- `services/spotify/` contains focused Spotify-specific helpers
- `realtime/` owns websocket queue distribution
- `middleware/` handles request/session concerns
- `bootstrap/dependencies.js` is the composition root

The codebase stays functional and explicit:

- no DI framework
- no hidden wiring
- no stateful classes in service flow
- small helper modules where specialization helps reasoning

## Important Backend Modules

- [src/bootstrap/dependencies.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/bootstrap/dependencies.js)
- [src/services/spotifyService.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/services/spotifyService.js)
- [src/services/spotifyGateway.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/services/spotifyGateway.js)
- [src/services/spotify/searchService.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/services/spotify/searchService.js)
- [src/realtime/queueRealtimeGateway.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/realtime/queueRealtimeGateway.js)
- [src/services/creditService.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/src/services/creditService.js)
- [tests/perf/runScenario.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/tests/perf/runScenario.js)
- [tests/perf/scenarios.js](c:/Users/Baz/Desktop/SpotifyProject/qusicians-backend/tests/perf/scenarios.js)

## Environment

Required:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/spotify/callback
FRONTEND_REDIRECT_URL=http://127.0.0.1:5173
REDIS_URL=redis://127.0.0.1:6379
```

Optional:

```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://127.0.0.1:5173
QUEUE_POLL_INTERVAL_MS=15000
SPOTIFY_GATEWAY_MAX_CONCURRENT=1
SPOTIFY_GATEWAY_MIN_INTERVAL_MS=75
SPOTIFY_GATEWAY_MAX_RETRIES=1
SPOTIFY_GATEWAY_RETRY_BASE_DELAY_MS=1000
PERF_METRICS=true
PERF_BASE_URL=http://127.0.0.1:3000
PERF_USERS=80
PERF_SEARCH_QUERY=drake
PERF_CACHE_WAVES=4
PERF_CACHE_WAVE_DELAY_MS=750
PERF_ADD_SETTLE_MS=17000
```

## Running Locally

```bash
npm install
npm run dev
```

### Local Redis Requirement

Local development requires a reachable Redis instance.

Recommended local option:

- run Redis locally
- set:

```env
REDIS_URL=redis://127.0.0.1:6379
```

Alternative option:

- use any hosted Redis-compatible instance
- set `REDIS_URL` to that remote connection string instead

Production on Render should use Render's managed Redis / Key Value service, but local development does not need that. The app only depends on `REDIS_URL`, so local and production can use different Redis endpoints without code changes.

### Local vs Production Session Cookies

The backend uses different cookie settings in local development and production so both environments work correctly.

Local development:

- `NODE_ENV` is not `production`
- cookie `sameSite` is `lax`
- cookie `secure` is `false`
- this works for `http://127.0.0.1:5173` talking to `http://127.0.0.1:3000`

Production:

- `NODE_ENV=production`
- cookie `sameSite` becomes `none`
- cookie `secure` becomes `true`
- server binds to `0.0.0.0` instead of `127.0.0.1`
- this is required when frontend and backend are on different HTTPS origins, such as separate Render services

This means you do not need one cookie configuration for local and another for Render by hand. The app switches behavior based on `NODE_ENV`.

## Performance Testing

The backend includes a built-in performance harness under `tests/perf/`.

Use it to validate:

- guest join concurrency
- search dedupe under simultaneous identical queries
- search cache reuse for delayed repeated queries
- batched add and flush behavior under burst traffic
- the full end-to-end guest flow using one shared joined cohort

### Perf Metrics

Set `PERF_METRICS=true` in your shell, then start the backend normally.

Example in bash:

```bash
export PERF_METRICS=true
npm run dev
```

Example in Windows `cmd`:

```cmd
set PERF_METRICS=true
npm run dev
```

### Full Run

Create one real host session in the app and leave it running, then run:

```bash
npm run perf:full -- YOUR_SESSION_ID
```

What `perf:full` does:

1. joins the configured guest cohort once
2. reuses that same guest cohort for the remaining phases
3. runs search dedupe using all joined guests concurrently
4. runs search cache waves using the same joined guests
5. runs add burst using the same joined guests after one track prefetch

Concurrency only exists within each phase. The phases themselves run sequentially.

### Output

The perf run writes JSON reports to `tests/perf/output/`.

It also prints live progress to the terminal, including:

- current phase name
- per-action counters such as `17/80`
- phase completion summaries
- Spotify operation summaries with status outcomes
- final combined report path

## Deployment Notes

- Current design assumes one backend instance and one Redis instance.
- Search cache and in-flight dedupe are process-local by design.
- If the backend is later scaled horizontally, search cache strategy should be revisited.
- Redis remains the source of truth for session and credit state.

## Render Deployment Notes

For a split Render deployment:

- frontend runs as a Static Site
- backend runs as a Web Service
- Redis/Key Value is provided as a managed Render service

Set these backend environment variables in production:

```env
NODE_ENV=production
CORS_ORIGIN=https://your-frontend-domain
FRONTEND_REDIRECT_URL=https://your-frontend-domain
SPOTIFY_REDIRECT_URI=https://your-backend-domain/spotify/callback
REDIS_URL=redis://...
```

Set this frontend environment variable:

```env
VITE_BACKEND_BASE_URL=https://your-backend-domain
```

Why this works:

- local development keeps `lax` non-secure cookies for `127.0.0.1`
- production switches to `SameSite=None` and `Secure`
- local development binds the backend to `127.0.0.1`, while Render production binds it to `0.0.0.0`
- frontend API requests already use `credentials: "include"`
- websocket connections already use `withCredentials: true`


