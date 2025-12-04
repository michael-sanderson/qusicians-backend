// Spotify API service factory

module.exports = (axios, config, logger) => {
  // Exchange code for access token
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

      logger.debug({ code }, "Spotify token exchange successful");
      return res.data;
    } catch (err) {
      logger.error({ err }, "Spotify token exchange failed");
      throw err;
    }
  };

   // Refresh Token
   const refreshAccessToken = async (refreshToken) => {
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

    logger.debug("Spotify access token refreshed");
    return res.data;
  };

  // Get current playback / queue
  const getQueue = async (accessToken) => {
    const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/me/player/queue`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.data;
  };

  // Add track to queue
  const addToQueue = async (accessToken, trackUri) => {
    try {
      const res = await axios.post(
        `${config.SPOTIFY.API_BASE_URL}/me/player/queue`,
        null, // no body required
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { uri: trackUri },
        }
      );
      logger.debug({ trackUri }, "Added track to Spotify queue");
      return res.data;
    } catch (err) {
      logger.error({ err }, "Failed to add track to Spotify queue");
      throw err;
    }
  };

  // Search for Spotify tracks)
  const searchTracks = async (accessToken, query) => {
    try {
      const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/search`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { q: query, type: 'track', limit: 20 },
      });
      logger.debug({ query }, "Spotify track search successful");
      return res.data.tracks.items;
    } catch (err) {
      logger.error({ err }, "Spotify track search failed");
      throw err;
    }
  };

    // Get current logged-in Spotify user
    const getCurrentUser = async (accessToken) => {
      try {
        const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        logger.debug({ userId: res.data.id }, 'Fetched current Spotify user');
        return res.data.id
      } catch (err) {
        logger.error({ err }, 'Failed to fetch current Spotify user')
        throw err
      }
    }

  // Return all services as a plain object
  return {
    exchangeCodeForToken,
    refreshAccessToken,
    getQueue,
    addToQueue,
    searchTracks,
    getCurrentUser
  };
};
