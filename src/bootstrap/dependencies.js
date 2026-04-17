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
const { AppError, ERROR_CATALOG, toHttpErrorFactory } = require("../errors");

// Infrastructure / utilities
const createRedisClient = require("../data/redisClient");
const { createLogger, createRequestLogger } = require("../middleware/logger");
const createRequireSession = require("../middleware/requireSession");
const createErrorResponder = require("../middleware/errorResponder");
const createPerfMetrics = require("../../tests/perf/metricsService");

// Services
const createSessionService = require("../services/sessionService");
const createOauthStateService = require("../services/oauthStateService");
const createSpotifyService = require("../services/spotifyService");
const createSpotifyGateway = require("../services/spotifyGateway");
const createCreditService = require("../services/creditService");

// Controllers
const createSessionController = require("../controllers/sessionController");
const createSpotifyController = require("../controllers/spotifyController");

// Utilities
const createSpotifyAuthUtil = require("../utils/spotifyAuthUtil");
const {
  parseSessionCookie,
  setSessionCookie,
  clearSessionCookie,
} = require("../utils/sessionUtil");

/* ------------------------------------------------------------------ */

function buildDependencies() {
  const realtimeQueueState = {
    getSnapshot: () => null,
    ensureFreshSnapshot: async () => null,
  };
  /* --------------------------------------------------------------
   * Core infrastructure
   * -------------------------------------------------------------- */

  const logger = createLogger(pino);
  const requestLogger = createRequestLogger(logger);
  const perfMetrics = createPerfMetrics(process.env.PERF_METRICS === "true");

  const redisClient = createRedisClient(createClient, logger);

  /* --------------------------------------------------------------
   * Runtime configuration
   * -------------------------------------------------------------- */

  const config = {
    ...C,
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    SPOTIFY_GATEWAY: {
      ...C.SPOTIFY_GATEWAY,
      MAX_CONCURRENT:
        process.env.SPOTIFY_GATEWAY_MAX_CONCURRENT || C.SPOTIFY_GATEWAY.MAX_CONCURRENT,
      MIN_INTERVAL_MS:
        process.env.SPOTIFY_GATEWAY_MIN_INTERVAL_MS || C.SPOTIFY_GATEWAY.MIN_INTERVAL_MS,
      MAX_RETRIES:
        process.env.SPOTIFY_GATEWAY_MAX_RETRIES || C.SPOTIFY_GATEWAY.MAX_RETRIES,
      RETRY_BASE_DELAY_MS:
        process.env.SPOTIFY_GATEWAY_RETRY_BASE_DELAY_MS ||
        C.SPOTIFY_GATEWAY.RETRY_BASE_DELAY_MS,
    },
  };

  /* --------------------------------------------------------------
   * Services
   * -------------------------------------------------------------- */

  const sessionService = createSessionService(
    redisClient,
    logger,
    C.SESSION_AND_STATE,
    AppError
  );

  const oauthStateService = createOauthStateService(
    crypto,
    redisClient,
    C.SESSION_AND_STATE
  );

  const creditService = createCreditService(
    redisClient,
    {
      ...C.CREDITS,
      SESSION_TTL_SECONDS: C.SESSION_AND_STATE.SESSION_TTL_SECONDS,
    },
    logger,
    AppError
  );

  const spotifyGateway = createSpotifyGateway(axios, config, logger, perfMetrics);

  const spotifyService = createSpotifyService(
    spotifyGateway,
    config,
    realtimeQueueState,
    sessionService.getSession,
    sessionService.persistSession,
    sessionService.appendPendingTrack,
    sessionService.removePendingTrack,
    creditService,
    perfMetrics,
    logger,
    AppError
  );

  /* --------------------------------------------------------------
   * Middleware
   * -------------------------------------------------------------- */

  const requireSession = createRequireSession(
    parseSessionCookie,
    sessionService,
    logger,
    AppError
  );
  
  const toHttpError = toHttpErrorFactory(ERROR_CATALOG);
  const errorResponder = createErrorResponder(toHttpError, logger);
  /* --------------------------------------------------------------
   * Controllers
   * -------------------------------------------------------------- */

  const sessionController = createSessionController(
    sessionService,
    creditService,
    setSessionCookie,
    clearSessionCookie,
    logger
  );

  const spotifyController = createSpotifyController(
    spotifyService,
    realtimeQueueState,
    createSpotifyAuthUtil(config),
    oauthStateService,
    sessionService,
    setSessionCookie,
    logger,
    AppError
  );
  /* -------------------------------------------------------------- */

  return {
    logger,
    realtimeQueueState,
    parseSessionCookie,
    sessionService,
    spotifyGateway,
    spotifyService,
    perfMetrics,
    requestLogger,
    requireSession,
    sessionController,
    spotifyController,
    errorResponder
  };
}

/* ------------------------------------------------------------------ */

module.exports = buildDependencies;

