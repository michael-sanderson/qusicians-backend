// server.js

// Load environment variables
require("dotenv").config();

// External libraries
const axios = require("axios");
const { createClient } = require("redis");
const crypto = require("crypto");
const express = require("express");
const pino = require("pino");

// Initialize factories & utils
const C = require("./config/constants");
const createLogger = require("./middleware/logger");
const createRedisClient = require("./data/redisClient");
const createSpotifyService = require("./services/spotifyService");
const createSpotifyController = require("./controllers/spotifyController");
const createSpotifyAuthUtil = require("./utils/spotifyAuthUtil");
const createRouter = require("./routes/index");
const createSessionService = require("./services/sessionService");

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

// Initialize Middleware
const logger = createLogger(pino);

// Initialize Redis client and attempt to connect
const redisClient = createRedisClient(createClient, logger);

// Build config object for DI // Args get destructured in service
const config = {
  ...C,
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
};

// Initialize session service
const sessionService = createSessionService(
  crypto,
  redisClient,
  logger,
  C.SESSION_AND_STATE
);

// Initialize Spotify service & auth util
const spotifyService = createSpotifyService(axios, config, logger);
const spotifyAuthUtil = createSpotifyAuthUtil(config);

// Initialize Spotify controller with session service injected
const spotifyController = createSpotifyController(
  spotifyService,
  spotifyAuthUtil,
  sessionService,
  logger
);

// Build context object for routes
const routerContext = { express, spotifyController, sessionService, logger };

// Request logging middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url, userAgent: req.headers['user-agent']}) // shows browser, bot, or curl etc. }, "Incoming request");
  next();
});


// Mount the routes normally without attaching to "/"
const routes = createRouter(routerContext);
app.use(routes); 

// Start server
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
