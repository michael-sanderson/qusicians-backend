// services/sessionService.js
//
// Session state manager.
// Responsible for creating, loading, mutating, and persisting
// session data in Redis. Not an HTTP-facing service.

module.exports = (redisClient, logger, C) => {
  /* ------------------------------------------------------------------
   * Redis helpers
   * ------------------------------------------------------------------ */

  const sessionKey = (sessionId) =>
    `${C.SESSION_PREFIX}${sessionId}`;

  /* ------------------------------------------------------------------
   * Session lifecycle
   * ------------------------------------------------------------------ */

  // Create and persist a new host session
  const createHostSession = async (sessionObj) => {
    const session = {
      ...sessionObj,
      createdAt: Date.now(),
      ttl: C.SESSION_TTL_SECONDS,
      guests: [],
    };

    await persistSession(session);

    logger.info(
      { sessionId: session.sessionId },
      "Host session created"
    );

    return session;
  };

  // Load an existing session from Redis
  const getSession = async (sessionId) => {
    try {
      const raw = await redisClient.get(sessionKey(sessionId));

      if (!raw) {
        logger.warn(
          { sessionId },
          "Session not found in store"
        );
        throw new Error("Session not found");
      }

      return JSON.parse(raw);
    } catch (err) {
      logger.error(
        { err, sessionId },
        "Failed to retrieve session"
      );
      throw err;
    }
  };

  // Add a guest to an existing session
  // This is the only mutation driven directly by an API request
  const addGuest = async (session, name) => {
    const updatedSession = {
      ...session,
      guests: [
        ...session.guests,
        {
          name,
          joinedAt: Date.now(),
        },
      ],
    };

    await persistSession(updatedSession);

    logger.info(
      {
        sessionId: updatedSession.sessionId,
        guestName: name,
      },
      "Guest successfully joined session"
    );

    return updatedSession;
  };

  /* ------------------------------------------------------------------
   * Persistence
   * ------------------------------------------------------------------ */

  // Persist session state back to Redis
  const persistSession = async (session) => {
    const ttl = session.ttl || C.SESSION_TTL_SECONDS;

    await redisClient.setEx(
      sessionKey(session.sessionId),
      ttl,
      JSON.stringify(session)
    );

    return session;
  };

  /* ------------------------------------------------------------------ */

  return {
    createHostSession,
    getSession,
    addGuest,
    persistSession,
  };
};
