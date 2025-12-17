// controllers/spotifyController.js

module.exports = (
  spotifyService,
  spotifyAuthUtil,
  oauthStateService,
  sessionService,
  setPartySessionCookie,
  logger
) => {
  /* ------------------------------------------------------------------
   * OAuth flow (complex → async/await)
   * ------------------------------------------------------------------ */

  const loginHandler = async (req, res) => {
    try {
      const state = await oauthStateService.generateAndStoreState();
      const authUrl = spotifyAuthUtil(state);

      logger.info(
        { state: state.slice(0, 6) + "..." },
        "Redirecting user to Spotify OAuth"
      );

      res.redirect(authUrl);
    } catch (err) {
      logger.error({ err }, "Failed to start Spotify OAuth");
      res.status(500).send("Internal error initiating Spotify OAuth");
    }
  };

  const callbackHandler = async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
      logger.warn("Spotify callback missing code or state");
      return res.status(400).send("Missing code or state");
    }

    try {
      const validState =
        await oauthStateService.verifyAndConsumeState(state);

      if (!validState) {
        logger.warn({ state }, "Invalid or expired OAuth state");
        return res.status(400).send("Invalid state");
      }

      const tokenData =
        await spotifyService.exchangeCodeForToken(code);

      const hostData =
        await spotifyService.getCurrentUser(
          tokenData.access_token
        );

      const sessionId = `${hostData.userId}-${state}`;

      await sessionService.createHostSession({
        sessionId,
        hostId: hostData.userId,
        hostDisplayName: hostData.displayName,
        hostProfileImageUrl: hostData.profileImageUrl,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiry:
          Date.now() + tokenData.expires_in * 1000,
      });

      logger.debug({ sessionId }, "Host session created");

      setPartySessionCookie(res, {
        sessionId,
        role: "host",
        userId: hostData.userId,
        displayName: hostData.displayName,
        profileImageUrl: hostData.profileImageUrl,
      });

      const frontendUrl =
        process.env.FRONTEND_REDIRECT_URL;
      res.redirect(`${frontendUrl}/dashboard`);
    } catch (err) {
      logger.error(
        { err },
        "Error during Spotify callback handling"
      );
      res.status(500).send("Error processing Spotify callback");
    }
  };

  /* ------------------------------------------------------------------
   * Spotify actions (simple → promise chains)
   * ------------------------------------------------------------------ */

  const getQueueHandler = (req, res) => {
    spotifyService
      .getQueue(req.session)
      .then((queue) => res.json(queue))
      .catch((err) => {
        logger.error({ err }, "Failed to get Spotify queue");
        res
          .status(500)
          .json({ error: "Failed to get Spotify queue" });
      });
  };

  const addToQueueHandler = (req, res) => {
    const { trackUri } = req.body;

    spotifyService
      .addToQueue(req.session, trackUri)
      .then((result) => res.json(result))
      .catch((err) => {
        logger.error(
          { err, trackUri },
          "Failed to add track to Spotify queue"
        );
        res
          .status(500)
          .json({ error: "Error adding track to Spotify queue" });
      });
  };

  const findTracksHandler = (req, res) => {
    spotifyService
      .findTracks(req.session, req.query)
      .then((tracks) => res.json(tracks))
      .catch((err) => {
        logger.error(
          { err },
          "Failed to perform Spotify track search"
        );
        res
          .status(500)
          .send("Error fetching tracks from search");
      });
  };

  return {
    loginHandler,
    callbackHandler,
    getQueueHandler,
    addToQueueHandler,
    findTracksHandler,
  };
};
