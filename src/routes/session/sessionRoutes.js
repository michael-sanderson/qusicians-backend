// routes/session/sessionRoutes.js

module.exports = (router, sessionController, requireSession) => {
  /* ------------------------------------------------------------------
   * Session entry
   * ------------------------------------------------------------------ */

  router.get("/current", requireSession, sessionController.currentSessionHandler);
  router.post("/join", sessionController.joinSessionHandler);

  /* ------------------------------------------------------------------
   * Session exit
   * ------------------------------------------------------------------ */

  router.post("/leave", requireSession, sessionController.leaveSessionHandler);

  /* ------------------------------------------------------------------
   * Session guests
   * ------------------------------------------------------------------ */

  router.get("/guests", requireSession, sessionController.getGuestListHandler);
}; 
