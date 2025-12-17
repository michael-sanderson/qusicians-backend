# Qusicians Backend

Node.js backend for **Qusicians**, a collaborative Spotify jukebox application.

This server handles Spotify OAuth onboarding, session management, and API endpoints for interacting with Spotify. The codebase is intentionally explicit, modular, and free of architectural fluff.

---

## Overview

**Qusicians** allows a host to create a shared Spotify session that guests can join.  
Guests can search for tracks and add them to the host’s Spotify queue in real time.

This backend is responsible for:

- Spotify OAuth login and callback handling
- Secure OAuth state management (CSRF protection)
- Session creation and lifecycle management
- Spotify API interactions (queue, search, add to queue)
- Enforcing session presence via middleware

---

## Design Principles

This project follows a few strict rules:

- **Explicit wiring** — no DI frameworks, no magic containers
- **Feature-based routing** — middleware scoped at feature boundaries
- **Thin controllers** — orchestration only, no business logic
- **Services own invariants** — side effects and external APIs live here
- **Utilities are pure** — small, boring, predictable
- **Fail fast** — Redis is treated as a critical dependency

If something is implicit, it’s probably wrong.

---

## Project Structure

```
src/
├── server.js            # Application entry point
├── app.js               # Express app factory
├── bootstrap/
│   └── dependencies.js  # Composition root
├── config/
│   └── constants.js     # Public constants and policies
├── controllers/         # HTTP request orchestration
├── middleware/          # Express middleware (auth, logging)
├── routes/              # Feature-based route definitions
├── services/            # Business logic & Spotify API integration
├── utils/               # Small pure utilities
└── data/
    └── redisClient.js   # Redis connection factory
```

---

## Features

- Spotify OAuth authentication
- Secure, short-lived OAuth state handling
- Session-based party system (host and guests)
- Retrieve Spotify queue
- Search for tracks
- Add tracks to the Spotify queue

---

## Environment Variables

### Required

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/spotify/callback
```

### Optional

```env
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
NODE_ENV=development
FRONTEND_REDIRECT_URL=http://127.0.0.1:5173
```

---

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/michael-sanderson/qusicians-backend.git
cd qusicians-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root using the variables above.

4. Start the server:
```bash
npm run dev
```

5. Begin Spotify OAuth flow:
```
GET /spotify/login
```

---

## Notes

- `.env` is gitignored to protect credentials
- Environment variables are loaded via `dotenv` at startup
- Redis is required for sessions and OAuth state
- Sessions use TTL-based expiry in Redis
- The architecture is designed to scale without refactoring core layers

---

## License

Copyright © 2025 Michael Matthews.
All rights reserved.

This source code is provided for viewing and evaluation purposes only.
No permission is granted to use, copy, modify, or distribute this code
without explicit written consent from the author.

## Disclaimer

Qusicians is an independent project and is not affiliated with, endorsed by,
or sponsored by Spotify. Spotify is a registered trademark of Spotify AB.

All use of Spotify trademarks, logos, and brand assets complies with Spotify’s
branding and design guidelines: https://developer.spotify.com/documentation/design

All trademarks, logos, and brand assets remain the property of their respective
rights holders.

This project uses the Spotify Web API in accordance with Spotify’s developer
terms.
