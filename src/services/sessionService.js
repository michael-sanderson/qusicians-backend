// Manages host sessions in Redis

module.exports = (crypto, redisClient, logger, C) => {
  /** --- OAuth State Methods --- **/

  // Generate and persist state ID short term
  const generateAndStoreState = async () => {
    const newState = crypto.randomBytes(16).toString("hex");
    await redisClient.setEx(
      C.STATE_PREFIX + newState,
      C.STATE_TTL_SECONDS,
      "valid"
    );
    return newState;
  };

  // Check state matches returned sate from Spotify then remove from Redis
  const verifyAndConsumeState = async (state) => {
    const key = C.STATE_PREFIX + state;
    const exists = await redisClient.get(key);
    if (!exists) return false;
    await redisClient.del(key);
    return true;
  };

  /** --- Session Methods --- **/

  // Create a new host session
  const createHostSession = async (sessionObj) => {
    const session = {
      ...sessionObj,
      createdAt: Date.now(),
      ttl: C.SESSION_TTL_SECONDS,
      guests: [],
      queue: [],
    };

    await redisClient.setEx(
      C.SESSION_PREFIX + session.sessionId,
      session.ttl,
      JSON.stringify(session)
    );
    logger.info(session.sessionId, "Host session created");
    return session;
  };

  // Main getSession function (always returns session with valid token)
  const getSession = async (sessionId, refreshTokenFn) => {
    const session = await redisClient.get(C.SESSION_PREFIX + sessionId);
    if (!session) throw new Error("Session not found");
    const parsedSession = JSON.parse(session)
    return refreshTokenIfExpired(parsedSession, refreshTokenFn);
  };

  // Lazy token refresh
  const refreshTokenIfExpired = async (session, refreshTokenFn) => {
    // If Token still valid
    if (session.accessTokenExpiry > Date.now()) return session;
    logger.debug({session}, "this is the session")
    logger.debug({token: session.refreshToken}, "this is the token")

    const tokenData = await refreshTokenFn(session.refreshToken);
    const updatedSession = {
      ...session,
      accessToken: tokenData.access_token,
      accessTokenExpiry: Date.now() + tokenData.expires_in * 1000,
    };

    return persistSession(updatedSession);
  };

  // Persist session immutably
  const persistSession = async (session) => {
    await redisClient.setEx(
      C.SESSION_PREFIX + session.sessionId,
      session.ttl || C.SESSION_TTL_SECONDS,
      JSON.stringify(session)
    );
    return session;
  };

  return {
    // OAuth state
    generateAndStoreState,
    verifyAndConsumeState,

    // Session management
    createHostSession,
    getSession,
    persistSession
  };
};
