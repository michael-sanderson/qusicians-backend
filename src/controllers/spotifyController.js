// Spotify controller factory

module.exports = (spotifyService, spotifyAuthUtil, sessionService, logger) => {
  // Redirect user to Spotify OAuth
  const login = async (req, res) => {
    try {
      // Store short-lived state (e.g. 5 mins)
      const state = await sessionService.generateAndStoreState();
      const authUrl = spotifyAuthUtil(state);

      logger.info(
        { state: state.slice(0, 6) + "..." },
        "State generated - redirecting user to Spotify OAuth"
      );

      res.redirect(authUrl);
    } catch (err) {
      logger.error({ err }, "Failed to start Spotify OAuth");
      res.status(500).send("Internal error initiating Spotify OAuth");
    }
  };

  // Spotify callback — validate state & create host session
  const callback = async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;

    if (!code || !state) {
      logger.warn("Callback missing code or state");
      return res.status(400).send("Missing code or state");
    }

    // Verify the state was stored
    try {
      const validState = await sessionService.verifyAndConsumeState(state);

      if (!validState) {
        logger.warn({ state }, "Invalid or expired OAuth state");
        return res.status(400).send("Invalid state");
      }

      // Exchange code for tokens
      const tokenData = await spotifyService.exchangeCodeForToken(code);

      // Get Spotify user
      const hostId = await spotifyService.getCurrentUser(
        tokenData.access_token
      );

      // Build session object
      const sessionObj = {
        hostId,
        sessionId: `${hostId}-${state}`,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiry: Date.now() + tokenData.expires_in * 1000,
      };

      // Persist session in Redis
      const session = await sessionService.createHostSession(sessionObj);

      // Attach session ID to request to be propagated by middleware on future API requests
      req.query.sessionId = session.sessionId;

      // Obfuscate sessionId for logging
      const obfuscatedSessionId = session.sessionId.slice(0, 6) + "***";
      logger.info({ sessionId: obfuscatedSessionId }, "Host session created");

      res.json({ sessionId: session.sessionId });
    } catch (err) {
      logger.error({ err }, "Error during Spotify callback handling");
      res.status(500).send("Error processing Spotify callback");
    }
  };

  // Pipeline-style host queue retrieval
  const getQueue = (req, res) => {
    const sessionId = req.query.sessionId;

    sessionService
      .getSession(sessionId, spotifyService.refreshAccessToken)
      .then((session) => spotifyService.getQueue(session.accessToken))
      .then((queue) => res.json(queue))
      .catch((err) => {
        logger.error({ err }, "Failed to get Spotify queue");
        res.status(500).send("Error fetching queue");
      });
  };

  return {
    login,
    callback,
    getQueue,
  };
};
