// middleware/requireSession.js
//
// Middleware that enforces the presence of a valid session cookie,
// loads the corresponding session from storage, and attaches it
// to the request object.

module.exports = (parseSessionCookie, sessionService, logger, AppError) => async (req, res, next) => {
  const parsed = parseSessionCookie(req.cookies.partySession);

  if (!parsed.ok) {
    logger.warn({ reason: parsed.error }, "Invalid or missing session cookie");

    // Map parse failures to catalog codes
    if (parsed.error === "Missing session cookie") {
      return next(new AppError("SESSION_COOKIE_MISSING"));
    }

    if (parsed.error === "Invalid session cookie") {
      return next(new AppError("SESSION_COOKIE_INVALID"));
    }

    return next(new AppError("SESSION_COOKIE_MALFORMED"));
  }

  try {
    const session = await sessionService.getSession(parsed.sessionId);

    req.session = session;
    req.userRole = parsed.role;
    req.userId = parsed.userId;
    req.displayName = parsed.displayName;
    req.avatarDataUrl = parsed.avatarDataUrl;

    return next();
  } catch (err) {
    if (err?.code === "SESSION_NOT_FOUND") {
      return next(new AppError("SESSION_INVALID_OR_EXPIRED"));
    }

    logger.error(
      { err, sessionId: parsed.sessionId },
      "Failed to load session from store"
    );

    return next(err);
  }
};
