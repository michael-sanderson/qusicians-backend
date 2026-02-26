// routes/spotify/spotifyRoutes.js
//
// Spotify feature routes.
// Public OAuth routes are defined first,
// followed by session-scoped routes protected by middleware.

module.exports = (router, requireSession, spotifyController) => {
  /* ------------------------------------------------------------------
   * Public routes (no session required)
   * ------------------------------------------------------------------ */

  router.get("/login", spotifyController.loginHandler);
  router.get("/callback", spotifyController.callbackHandler);

  /* ------------------------------------------------------------------
   * Feature-scoped middleware
   * ------------------------------------------------------------------ */

  // All routes below this point require an active session
  router.use(requireSession);

  /* ------------------------------------------------------------------
   * Session-scoped routes
   * ------------------------------------------------------------------ */

  router.get("/queue", spotifyController.getQueueHandler);
  router.get("/search", spotifyController.findTracksHandler);
  router.post("/add", spotifyController.addSongHandler);
  router.post("/import-playlist", spotifyController.importPlaylistHandler);
};
