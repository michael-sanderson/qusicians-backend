// controllers/sessionController.js
//
// Session lifecycle controller.
// Handles joining a session and defines a placeholder for leaving.

module.exports = (
  sessionService,
  setPartySessionCookie,
  logger
) => {
  /* ------------------------------------------------------------------
   * Join session
   * ------------------------------------------------------------------ */

  const joinSessionHandler = (req, res) => {
    // Early exit: user already has a session
    if (req.cookies?.partySession) {
      const frontendUrl =
        process.env.FRONTEND_REDIRECT_URL;
      return res.redirect(`${frontendUrl}/dashboard`);
    }

    const { sessionId, name = "Guest" } = req.body;

    if (!sessionId) {
      logger.warn("Join session missing sessionId");
      return res.status(400).send("Missing sessionId");
    }

    sessionService
      .getSession(sessionId)
      .then((session) =>
        sessionService.addGuest(session, name)
      )
      .then((updatedSession) => {
        setPartySessionCookie(res, {
          sessionId: updatedSession.sessionId,
          role: "guest",
          displayName: name,
        });

        const frontendUrl =
          process.env.FRONTEND_REDIRECT_URL;
        res.redirect(`${frontendUrl}/dashboard`);
      })
      .catch((err) => {
        logger.error(
          { err, sessionId },
          "Failed to join session"
        );
        res.status(500).send("Error joining session");
      });
  };

  /* ------------------------------------------------------------------
   * Leave session (placeholder)
   * ------------------------------------------------------------------ */

  const leaveSessionHandler = (req, res) => {
    logger.info(
      { route: "/session/leave" },
      "Leave session endpoint called (not implemented)"
    );

    res.status(501).json({
      error: "Leave session not implemented yet",
    });
  };

  /* ------------------------------------------------------------------ */

  return {
    joinSessionHandler,
    leaveSessionHandler,
  };
};
