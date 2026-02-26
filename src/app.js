// app.js
//
// Express application factory.
// Responsible for wiring middleware, routes, and dependencies.
// Does NOT start the HTTP server.

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const createRouter = require("./routes");
const buildDependencies = require("./bootstrap/dependencies");

// Feature route factories
const sessionRoutes = require("./routes/session/sessionRoutes");
const spotifyRoutes = require("./routes/spotify/spotifyRoutes");

/* ------------------------------------------------------------------ */

function createApp() {
  // Create express instance
  const app = express();

  // Build application dependencies (services, controllers, middleware)
  const {
    requestLogger,
    requireSession,
    sessionController,
    spotifyController,
    errorResponder
  } = buildDependencies();

  /* ------------------------------------------------------------------
   * Global middleware
   * ------------------------------------------------------------------ */

  // CORS must come early
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "http://127.0.0.1:5173",
      credentials: true,
    })
  );

  // Body parsing
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Cookie parsing (required for session handling)
  app.use(cookieParser());

  // Request logging (after parsers so metadata is available)
  app.use(requestLogger);

  /* ------------------------------------------------------------------
   * Routes
   * ------------------------------------------------------------------ */

  const router = createRouter({
    express,
    requireSession,
    sessionController,
    spotifyController,
    sessionRoutes,
    spotifyRoutes,
  });

  app.use(router);
  app.use(errorResponder);

  return app;
}

/* ------------------------------------------------------------------ */

module.exports = createApp;
