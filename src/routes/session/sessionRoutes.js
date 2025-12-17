// routes/session/sessionRoutes.js
//
// Session lifecycle routes.
// Handles joining and (eventually) leaving a session.

module.exports = (router, sessionController) => {
  /* ------------------------------------------------------------------
   * Session entry
   * ------------------------------------------------------------------ */

  router.post("/join", sessionController.joinSessionHandler);

  /* ------------------------------------------------------------------
   * Session exit (placeholder)
   * ------------------------------------------------------------------ */

  // Explicit placeholder so the route contract exists
  router.post("/leave", (req, res) => {
    res.status(501).json({
      error: "Leave session not implemented yet",
    });
  });
};
