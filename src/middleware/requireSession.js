// middleware/requireSession.js
//
// Middleware that enforces the presence of a valid session cookie,
// loads the corresponding session from storage, and attaches it
// to the request object. Does not perform token refresh or authorization.

module.exports =
  (parseSessionCookie, sessionService, logger) =>
  async (req, res, next) => {
    // Parse and validate session cookie
    const parsed = parseSessionCookie(
      req.cookies.partySession
    );

    if (!parsed.ok) {
      logger.warn(
        { reason: parsed.error },
        "Invalid or missing session cookie"
      );
      return res.status(400).json({ error: parsed.error });
    }

    try {
      // Load session from store
      const session = await sessionService.getSession(
        parsed.sessionId
      );

      // Attach session to request for downstream handlers
      req.session = session;
      next();
    } catch (err) {
      logger.error(
        { err, sessionId: parsed.sessionId },
        "Failed to load session from store"
      );
      res
        .status(500)
        .json({ error: "Failed to load session" });
    }
  };
