// controllers/sessionController.js
//
// Session HTTP handlers.
// Delegates business rules to services and forwards errors to global error middleware.

module.exports = (
  sessionService,
  creditService,
  realtimeQueueState,
  setSessionCookie,
  clearSessionCookie,
  logger
) => {
  /* ------------------------------------------------------------------
   * Current session
   * ------------------------------------------------------------------ */

  const currentSessionHandler = (req, res) =>
    res.json({
      sessionId: req.session.sessionId,
      role: req.userRole,
      userId: req.userId || null,
      displayName: req.displayName || null,
      profileImageUrl: req.session.hostProfileImageUrl || null,
    });

  /* ------------------------------------------------------------------
   * Join session
   * ------------------------------------------------------------------ */

  const joinSessionHandler = (req, res, next) => {
    const { sessionId, name = "Guest", avatarDataUrl = null } = req.body;

    if (!sessionId) {
      const err = new Error("Missing sessionId");
      err.code = "MISSING_SESSION_ID";
      return next(err);
    }

    return sessionService
      .joinSession(sessionId, name, avatarDataUrl)
      .then((sessionEnvelope) => {
        setSessionCookie(res, {
          sessionId: sessionEnvelope.sessionId,
          role: sessionEnvelope.role,
          displayName: sessionEnvelope.displayName,
          profileImageUrl: sessionEnvelope.profileImageUrl,
        });
        return res.status(200).json({ success: true });
      })
      .catch((err) => {
        if (err?.code === "DISPLAY_NAME_TAKEN") {
          logger.warn({ sessionId, name }, "Duplicate display name attempt");
        }
        return next(err);
      });
  };

  /* ------------------------------------------------------------------
   * Leave session
   * ------------------------------------------------------------------ */

  const leaveSessionHandler = (req, res, next) => {
    const sessionId = req.session.sessionId;
    const isHostEnding =
      req.userRole === "host" && req.userId === req.session.hostId;
    const op = isHostEnding
      ? sessionService
          .endSession(sessionId)
          .then(() =>
            realtimeQueueState.notifySessionEnded?.(sessionId, "host_ended_session")
          )
      : req.displayName
      ? sessionService.leaveSession(sessionId, req.displayName)
      : Promise.resolve();

    return op
      .then(() => {
        clearSessionCookie(res);
        return res.status(204).end();
      })
      .catch((err) => {
        // Keep leave idempotent
        if (err?.code === "SESSION_NOT_FOUND") {
          clearSessionCookie(res);
          return res.status(204).end();
        }

        return next(err);
      });
  };

  /* ------------------------------------------------------------------
   * Get guest list
   * ------------------------------------------------------------------ */

  const getGuestListHandler = async (req, res, next) => {
    try {
      const guests = req.session.guests || [];
      const guestEntries = await Promise.all(
        guests.map(async (guest) => {
          const credits = await creditService.getCredits(req.session.sessionId, {
            role: "guest",
            displayName: guest.name,
          });

          return {
            name: guest.name,
            avatarDataUrl: guest.avatarDataUrl || null,
            creditsRemaining: credits.remaining,
          };
        })
      );
      return res.json({ guests: guestEntries });
    } catch (err) {
      return next(err);
    }
  };

  return {
    currentSessionHandler,
    joinSessionHandler,
    leaveSessionHandler,
    getGuestListHandler,
  };
};
