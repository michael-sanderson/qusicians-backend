// bootstrap/dependencies.js
//
// Application composition root.
// Responsible for constructing and wiring all runtime dependencies.
// No business logic should live here.

const axios = require("axios");
const crypto = require("crypto");
const pino = require("pino");
const { createClient } = require("redis");

const C = require("../config/constants");

// Infrastructure / utilities
const createRedisClient = require("../data/redisClient");
const { createLogger, createRequestLogger } = require("../middleware/logger");
const createRequireSession = require("../middleware/requireSession");

// Services
const createSessionService = require("../services/sessionService");
const createOauthStateService = require("../services/oauthStateService");
const createSpotifyService = require("../services/spotifyService");

// Controllers
const createSessionController = require("../controllers/sessionController");
const createSpotifyController = require("../controllers/spotifyController");

// Utilities
const createSpotifyAuthUtil = require("../utils/spotifyAuthUtil");
const parseSessionCookie = require("../utils/parseSessionCookie");
const setPartySessionCookie = require("../utils/setSessionCookie");

/* ------------------------------------------------------------------ */

function buildDependencies() {
  /* --------------------------------------------------------------
   * Core infrastructure
   * -------------------------------------------------------------- */

  const logger = createLogger(pino);
  const requestLogger = createRequestLogger(logger);

  const redisClient = createRedisClient(createClient, logger);

  /* --------------------------------------------------------------
   * Runtime configuration
   * -------------------------------------------------------------- */

  const config = {
    ...C,
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  };

  /* --------------------------------------------------------------
   * Services
   * -------------------------------------------------------------- */

  const sessionService = createSessionService(
    redisClient,
    logger,
    C.SESSION_AND_STATE
  );

  const oauthStateService = createOauthStateService(
    crypto,
    redisClient,
    C.SESSION_AND_STATE
  );

  const spotifyService = createSpotifyService(
    axios,
    config,
    sessionService.persistSession,
    logger
  );

  /* --------------------------------------------------------------
   * Middleware
   * -------------------------------------------------------------- */

  const requireSession = createRequireSession(
    parseSessionCookie,
    sessionService,
    logger
  );

  /* --------------------------------------------------------------
   * Controllers
   * -------------------------------------------------------------- */

  const sessionController = createSessionController(
    sessionService,
    setPartySessionCookie,
    logger
  );

  const spotifyController = createSpotifyController(
    spotifyService,
    createSpotifyAuthUtil(config),
    oauthStateService,
    sessionService,
    setPartySessionCookie,
    logger
  );

  /* -------------------------------------------------------------- */

  return {
    requestLogger,
    requireSession,
    sessionController,
    spotifyController,
  };
}

/* ------------------------------------------------------------------ */

module.exports = buildDependencies;
