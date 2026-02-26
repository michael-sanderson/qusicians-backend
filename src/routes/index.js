// routes/index.js
//
// Root router factory.
// Composes feature routers and mounts them under their base paths.
// Does not contain route logic itself.

const express = require("express");

module.exports = ({
  requireSession,
  sessionController,
  sessionRoutes,
  spotifyController,
  spotifyRoutes,
}) => {
  // Root router
  const rootRouter = express.Router();

  // Feature routers
  const sessionRouter = express.Router();
  const spotifyRouter = express.Router();

  /* ------------------------------------------------------------------
   * Register feature routes
   * ------------------------------------------------------------------ */

  // Session routes (no auth required)
  sessionRoutes(sessionRouter, sessionController, requireSession);

  // Spotify routes (require active session)
  spotifyRoutes(spotifyRouter, requireSession, spotifyController);

  /* ------------------------------------------------------------------
   * Mount feature routers
   * ------------------------------------------------------------------ */

  rootRouter.use("/session", sessionRouter);
  rootRouter.use("/spotify", spotifyRouter);

  /* ------------------------------------------------------------------
   * Fallback
   * ------------------------------------------------------------------ */

  // Catch-all for unmatched routes
  rootRouter.use((req, res) => {
    res.status(404).send("Not found");
  });

  return rootRouter;
};
