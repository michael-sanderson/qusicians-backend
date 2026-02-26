// controllers/spotifyController.js
//
// Spotify HTTP controller.
// Delegates business logic to services and forwards errors to global error middleware.

module.exports = (
  spotifyService,
  spotifyAuthUtil,
  oauthStateService,
  sessionService,
  setSessionCookie,
  logger,
  AppError
) => {
  const loginHandler = async (req, res, next) => {
    try {
      const state = await oauthStateService.generateAndStoreState();
      const authUrl = spotifyAuthUtil(state);

      logger.info(
        { state: state.slice(0, 6) + "..." },
        "Redirecting user to Spotify OAuth"
      );

      return res.redirect(authUrl);
    } catch (err) {
      logger.error({ err }, "Failed to start Spotify OAuth");
      return next(new AppError("SPOTIFY_OAUTH_INIT_FAILED"));
    }
  };

  const callbackHandler = async (req, res, next) => {
    const { code, state } = req.query;

    if (!code || !state) {
      return next(new AppError("OAUTH_CODE_OR_STATE_MISSING"));
    }

    try {
      const validState = await oauthStateService.verifyAndConsumeState(state);

      if (!validState) {
        logger.warn({ state }, "Invalid or expired OAuth state");
        return next(new AppError("OAUTH_STATE_INVALID"));
      }

      const tokenData = await spotifyService.exchangeCodeForToken(code);
      const hostData = await spotifyService.getCurrentUser(tokenData.access_token);

      const sessionId = `${hostData.userId}-${state}`;

      await sessionService.createHostSession({
        sessionId,
        hostId: hostData.userId,
        hostProfileImageUrl: hostData.profileImageUrl,
        playlistId: hostData.playlistId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiry: Date.now() + tokenData.expires_in * 1000,
      });

      setSessionCookie(res, {
        sessionId,
        role: "host",
        userId: hostData.userId,
        profileImageUrl: hostData.profileImageUrl,
      });

      return res.redirect(`${process.env.FRONTEND_REDIRECT_URL}/dashboard`);
    } catch (err) {
      logger.error({ err }, "Error during Spotify callback handling");
      return next(new AppError("SPOTIFY_CALLBACK_FAILED"));
    }
  };

  const getQueueHandler = (req, res, next) =>
    spotifyService
      .getQueue(req.session)
      .then((queue) => res.json(queue))
      .catch((err) => {
        logger.error({ err }, "Failed to get Spotify queue");
        return next(new AppError("SPOTIFY_QUEUE_FETCH_FAILED"));
      });

  const addSongHandler = (req, res, next) =>
    spotifyService
      .addSong(req.session, req.body?.trackUri, {
        role: req.userRole,
        displayName: req.displayName,
        avatarDataUrl: req.avatarDataUrl,
      })
      .then((result) => res.json(result))
      .catch((err) => {
        if (err?.code === "INVALID_TRACK_URI") return next(err);
        logger.error({ err, trackUri: req.body?.trackUri }, "Failed to add track");
        return next(new AppError("SPOTIFY_ADD_FAILED"));
      });

  const findTracksHandler = (req, res, next) =>
    spotifyService
      .findTracks(req.session, req.query?.q)
      .then((tracks) => res.json(tracks))
      .catch((err) => {
        if (err?.code === "INVALID_SEARCH_QUERY") return next(err);
        logger.error({ err }, "Failed to perform Spotify track search");
        return next(new AppError("SPOTIFY_SEARCH_FAILED"));
      });

  const importPlaylistHandler = (req, res, next) => {
    if (req.userRole !== "host") {
      return next(new AppError("FORBIDDEN_HOST_ONLY"));
    }

    return spotifyService
      .importPlaylist(req.session, req.body?.playlistId)
      .then((result) => res.json(result))
      .catch((err) => {
        const passthroughCodes = new Set([
          "INVALID_PLAYLIST_ID",
          "PLAYLIST_NOT_FOUND",
          "PLAYLIST_ACCESS_DENIED",
          "SPOTIFY_RATE_LIMITED",
        ]);

        if (passthroughCodes.has(err?.code)) {
          logger.warn(
            { code: err.code, playlistId: req.body?.playlistId },
            "Playlist import validation/access issue"
          );
          return next(err);
        }
        logger.error({ err, playlistId: req.body?.playlistId }, "Failed to import playlist");
        return next(new AppError("SPOTIFY_ADD_FAILED"));
      });
  };

  return {
    loginHandler,
    callbackHandler,
    getQueueHandler,
    addSongHandler,
    findTracksHandler,
    importPlaylistHandler,
  };
};
