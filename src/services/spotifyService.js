// services/spotifyService.js
//
// Spotify API boundary.
// This service guarantees that any Spotify API call is made
// with a valid access token. Callers never need to refresh tokens.

module.exports = (axios, config, persistSession, logger) => {
  /* ------------------------------------------------------------------
   * Public API — Consumed by controller handlers
   * ------------------------------------------------------------------ */

  // Exchange authorization code for initial access + refresh tokens
  const exchangeCodeForToken = async (code) => {
    try {
      const payload = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString();

      const res = await axios.request({
        method: "POST",
        url: config.SPOTIFY.TOKEN_URL,
        data: payload,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      logger.debug("Spotify token exchange successful");
      return res.data;
    } catch (err) {
      logger.error({ err }, "Spotify token exchange failed");
      throw err;
    }
  };

  // Fetch the current Spotify user (used during OAuth callback)
  const getCurrentUser = async (accessToken) => {
    try {
      const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      logger.debug({ userId: res.data.id }, "Fetched current Spotify user");

      return {
        userId: res.data.id,
        profileImageUrl: res.data.images?.[0]?.url || null,
      };
    } catch (err) {
      logger.error({ err }, "Failed to fetch current Spotify user");
      throw err;
    }
  };

  // Get current playback queue
  const getQueue = async (session) => {
    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.get(
        `${config.SPOTIFY.API_BASE_URL}/me/player/queue`,
        {
          headers: {
            Authorization: `Bearer ${validSession.accessToken}`,
          },
        }
      );

      const { currently_playing, queue } = res.data;

      return {
        nowPlaying: formatTrack(currently_playing),
        upNext: formatTrack(queue[0]),
        queue: queue.map(formatTrack),
      };
    } catch (err) {
      logger.error(
        {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        },
        "Failed to fetch Spotify queue"
      );
      throw err;
    }
  };

  // Add a track to the playback queue
  const addToQueue = async (session, trackUri) => {
    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.post(
        `${config.SPOTIFY.API_BASE_URL}/me/player/queue`,
        null,
        {
          headers: {
            Authorization: `Bearer ${validSession.accessToken}`,
          },
          params: { uri: trackUri },
        }
      );

      logger.info({ trackUri }, "Added track to Spotify queue");
      return res.data;
    } catch (err) {
      logger.error({ err, trackUri }, "Failed to add track to Spotify queue");
      throw err;
    }
  };

  // Search for tracks
  const findTracks = async (session, query) => {
    const q = typeof query === "string" ? query : query.q;

    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.get(
        `${config.SPOTIFY.API_BASE_URL}/search`,
        {
          headers: {
            Authorization: `Bearer ${validSession.accessToken}`,
          },
          params: { q, type: "track", limit: 50 },
        }
      );

      logger.info({ q }, "Spotify track search successful");
      return res.data.tracks.items.map(formatTrack);
    } catch (err) {
      logger.error(
        {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
          query: q,
        },
        "Spotify track search failed"
      );
      throw err;
    }
  };

  /* ------------------------------------------------------------------
   * Internal helpers — not exported
   * ------------------------------------------------------------------ */

  // Refresh access token using refresh token
  const refreshAccessToken = async (refreshToken) => {
    try {
      const payload = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString();

      const res = await axios.request({
        method: "POST",
        url: config.SPOTIFY.TOKEN_URL,
        data: payload,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      logger.info("Spotify access token refreshed");
      return res.data;
    } catch (err) {
      logger.error({ err }, "Spotify access token refresh failed");
      throw err;
    }
  };

  // Ensure the session contains a valid Spotify access token.
  // Refreshes and persists the session only if required.
  const ensureValidSession = async (session) => {
    if (session.accessTokenExpiry > Date.now()) {
      return session;
    }

    logger.info(
      { sessionId: session.sessionId.slice(0, 6) + "..." },
      "Spotify access token expired, refreshing"
    );

    const tokenData = await refreshAccessToken(session.refreshToken);

    const updatedSession = {
      ...session,
      accessToken: tokenData.access_token,
      accessTokenExpiry: Date.now() + tokenData.expires_in * 1000,
    };

    await persistSession(updatedSession);
    return updatedSession;
  };

  // Normalize Spotify track objects into app-friendly shape
  const formatTrack = (track) => {
    if (!track) return null;

    return {
      title: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      artwork: track.album.images[0].url,
      uri: track.uri,
    };
  };

  /* ------------------------------------------------------------------ */

  return {
    exchangeCodeForToken,
    getCurrentUser,
    getQueue,
    addToQueue,
    findTracks,
  };
};
