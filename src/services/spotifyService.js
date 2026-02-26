// services/spotifyService.js
//
// Spotify API boundary.
// Ensures all Spotify calls run with a valid access token.

module.exports = (axios, config, persistSession, logger, AppError) => {
  /* ------------------------------------------------------------------
   * Public API (used by controllers)
   * ------------------------------------------------------------------ */

  // Exchange authorization code for initial access and refresh tokens.
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

  // Fetch current Spotify user and resolve/create the app playlist.
  const getCurrentUser = async (accessToken) => {
    try {
      // 1) Fetch basic user profile
      const userRes = await axios.get(`${config.SPOTIFY.API_BASE_URL}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const userId = userRes.data.id;
      const profileImageUrl = userRes.data.images?.[0]?.url || null;

      logger.debug({ userId }, "Fetched current Spotify user");

      // 2) Fetch the user's playlists
      const playlistsRes = await axios.get(
        `${config.SPOTIFY.API_BASE_URL}/me/playlists?limit=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const existingPlaylist = playlistsRes.data.items.find(
        (p) => p.name === "Qusicians"
      );

      // 3) Reuse existing playlist or create a new one
      const playlist = existingPlaylist
        ? existingPlaylist
        : (
            await axios.post(
              `${config.SPOTIFY.API_BASE_URL}/users/${userId}/playlists`,
              { name: "Qusicians", public: false },
              { headers: { Authorization: `Bearer ${accessToken}` } }
            )
          ).data;

      if (existingPlaylist) {
        logger.debug(
          { userId, playlistId: playlist.id },
          '"Qusicians" playlist already exists'
        );
      } else {
        logger.info(
          { userId, playlistId: playlist.id },
          'Created new "Qusicians" playlist'
        );
      }

      // 4) Return normalized user context
      return {
        userId,
        profileImageUrl,
        playlistId: playlist.id,
      };
    } catch (err) {
      logger.error({ err }, "Failed to fetch current Spotify user");
      throw err;
    }
  };

  // Get current playback queue.
  const getQueue = async (session) => {
    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/me/player/queue`, {
        headers: {
          Authorization: `Bearer ${validSession.accessToken}`,
        },
      });

      const { currently_playing, queue } = res.data;
      const nowPlayingTrack = formatTrack(currently_playing);
      const queueTracks = queue.map(formatTrack);
      const trackAttributions = normalizeAttributions(
        validSession.trackAttributions
      );
      const decorated = decorateWithAttribution(
        nowPlayingTrack,
        queueTracks,
        trackAttributions
      );
      const previousSnapshot = validSession.currentNowPlayingSnapshot || null;
      const previousUri = previousSnapshot?.uri || null;
      const currentUri = decorated.nowPlaying?.uri || null;
      const hasTrackTransition = previousUri !== currentUri;
      const lastPlayedTrack =
        hasTrackTransition && previousSnapshot?.uri
          ? previousSnapshot
          : validSession.lastPlayedTrack || null;

      if (hasTrackTransition) {
        await persistSession({
          ...validSession,
          currentNowPlayingSnapshot: decorated.nowPlaying || null,
          lastPlayedTrack,
        });
      }

      return {
        nowPlaying: decorated.nowPlaying,
        upNext: decorated.queue[0] ?? null,
        queue: decorated.queue,
        lastPlayed: lastPlayedTrack,
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

  // Add a track to the Qusicians playlist.
  const addSong = async (session, trackUri, actor = {}) => {
    if (!trackUri || typeof trackUri !== "string") {
      throw new AppError("INVALID_TRACK_URI");
    }

    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.post(
        `${config.SPOTIFY.API_BASE_URL}/playlists/${validSession.playlistId}/items`,
        { uris: [trackUri] },
        {
          headers: {
            Authorization: `Bearer ${validSession.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const guest =
        actor?.role === "guest"
          ? resolveGuestByName(validSession.guests, actor.displayName)
          : null;
      const trackAttributions = {
        ...normalizeAttributions(validSession.trackAttributions),
        [trackUri]: resolveAddedBy(actor, guest, validSession.hostProfileImageUrl),
      };

      await persistSession({
        ...validSession,
        trackAttributions,
      });

      logger.info({ trackUri }, "Added track to Spotify playlist");
      return res.data;
    } catch (err) {
      logger.error({ err, trackUri }, "Failed to add track to Spotify playlist");
      throw err;
    }
  };

  // Search Spotify tracks.
  const findTracks = async (session, query) => {
    const q = typeof query === "string" ? query.trim() : query?.q?.trim();

    if (!q) {
      throw new AppError("INVALID_SEARCH_QUERY");
    }

    try {
      const validSession = await ensureValidSession(session);

      const res = await axios.get(`${config.SPOTIFY.API_BASE_URL}/search`, {
        headers: {
          Authorization: `Bearer ${validSession.accessToken}`,
        },
        params: { q, type: "track", limit: 50 },
      });

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

  const importPlaylist = async (session, sourcePlaylistIdOrUrl) => {
    const sourcePlaylistId = resolvePlaylistId(sourcePlaylistIdOrUrl);

    if (!sourcePlaylistId) {
      throw new AppError("INVALID_PLAYLIST_ID");
    }

    try {
      const validSession = await ensureValidSession(session);
      const sourceUris = await fetchSourcePlaylistTrackUris(
        validSession.accessToken,
        sourcePlaylistId
      );
      const uniqueUris = [...new Set(sourceUris)];

      if (uniqueUris.length === 0) {
        return { success: true, importedCount: 0, sourcePlaylistId };
      }

      await appendTracksToPlaylist(
        validSession.accessToken,
        validSession.playlistId,
        uniqueUris
      );

      logger.info(
        {
          sourcePlaylistId,
          targetPlaylistId: validSession.playlistId,
          importedCount: uniqueUris.length,
        },
        "Imported playlist tracks into Qusicians playlist"
      );

      return {
        success: true,
        importedCount: uniqueUris.length,
        sourcePlaylistId,
      };
    } catch (err) {
      logger.warn(
        {
          phase: err?.phase || "unknown",
          status: err?.response?.status,
          data: err?.response?.data,
          sourcePlaylistId,
        },
        "Spotify import upstream error"
      );
      const mapped = mapSpotifyImportError(err);
      if (mapped) {
        throw mapped;
      }
      logger.error({ err, sourcePlaylistId }, "Playlist import failed");
      throw err;
    }
  };

  /* ------------------------------------------------------------------
   * Internal helpers (not exported)
   * ------------------------------------------------------------------ */

  // Refresh access token using the refresh token.
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
  // Refresh and persist only when required.
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

  // Normalize Spotify track objects into app-friendly shape.
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

  const resolveAddedBy = (actor, guest, hostProfileImageUrl = null) => {
    if (actor?.role === "host") {
      return {
        name: "Host",
        role: "host",
        avatarDataUrl: hostProfileImageUrl,
      };
    }

    const name =
      typeof actor?.displayName === "string" ? actor.displayName.trim() : "";
    const avatarDataUrl = guest?.avatarDataUrl || actor?.avatarDataUrl || null;

    return {
      name: name || "Host",
      role: "guest",
      avatarDataUrl,
    };
  };

  // Match attribution metadata to visible tracks.
  const decorateWithAttribution = (nowPlaying, queue, attributions = {}) => {
    const visible = [nowPlaying, ...queue].filter(Boolean);
    const decoratedVisible = visible.map((track) => {
      return {
        ...track,
        addedBy:
          attributions[track.uri] ||
          {
            name: "Host",
            role: "host",
            avatarDataUrl: null,
          },
      };
    });

    return {
      nowPlaying: decoratedVisible[0] || null,
      queue: decoratedVisible.slice(nowPlaying ? 1 : 0),
    };
  };

  const normalizeAttributions = (raw) => {
    if (!raw) return {};

    if (Array.isArray(raw)) {
      return raw.reduce((acc, entry) => {
        if (entry?.uri) {
          acc[entry.uri] = normalizeAddedBy(entry.addedBy);
        }
        return acc;
      }, {});
    }

    if (typeof raw === "object") {
      return Object.keys(raw).reduce((acc, uri) => {
        acc[uri] = normalizeAddedBy(raw[uri]);
        return acc;
      }, {});
    }

    return {};
  };

  const normalizeAddedBy = (value) => {
    if (!value) {
      return {
        name: "Host",
        role: "host",
        avatarDataUrl: null,
      };
    }

    if (typeof value === "string") {
      return {
        name: value.trim() || "Host",
        role: value.trim().toLowerCase() === "host" ? "host" : "guest",
        avatarDataUrl: null,
      };
    }

    return {
      name: value.name || "Host",
      role: value.role || "guest",
      avatarDataUrl: value.avatarDataUrl || null,
    };
  };

  const resolveGuestByName = (guests, displayName) => {
    const normalizedDisplayName =
      typeof displayName === "string" ? displayName.trim().toLowerCase() : "";

    if (!normalizedDisplayName || !Array.isArray(guests)) {
      return null;
    }

    return (
      guests.find(
        (guest) =>
          typeof guest?.name === "string" &&
          guest.name.trim().toLowerCase() === normalizedDisplayName
      ) || null
    );
  };

  const resolvePlaylistId = (input) => {
    if (typeof input !== "string") return null;

    const trimmed = input.trim();

    if (!trimmed) return null;

    return /^[A-Za-z0-9]{22}$/.test(trimmed) ? trimmed : null;
  };

  const mapSpotifyImportError = (err) => {
    const status = err?.response?.status;
    const phase = err?.phase || "unknown";

    if (!status) {
      return null;
    }

    if (status === 404) {
      logger.warn({ phase }, "Spotify import received 404");
      return phase === "append_target_playlist"
        ? new AppError("SPOTIFY_ADD_FAILED")
        : new AppError("PLAYLIST_NOT_FOUND");
    }

    if (status === 403) {
      logger.warn({ phase }, "Spotify import received 403");
      return new AppError("PLAYLIST_ACCESS_DENIED");
    }

    if (status === 429) {
      logger.warn({ phase }, "Spotify import received 429");
      return new AppError("SPOTIFY_RATE_LIMITED");
    }

    return null;
  };

  const fetchSourcePlaylistTrackUris = async (accessToken, playlistId) => {
    const firstPage = await axios
      .get(`${config.SPOTIFY.API_BASE_URL}/playlists/${playlistId}/items`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          limit: 100,
          fields: "items(track(uri)),next",
        },
      })
      .catch((err) => {
        err.phase = "fetch_source_playlist";
        throw err;
      });

    const initialUris = (firstPage.data?.items || [])
      .map((item) => item?.track?.uri || null)
      .filter(Boolean);
    const initialNext = firstPage.data?.next || null;

    return fetchPlaylistItemsPageUris(accessToken, initialNext, initialUris);
  };

  const fetchPlaylistItemsPageUris = async (accessToken, nextUrl, acc) => {
    if (!nextUrl) {
      return acc;
    }

    const page = await axios
      .get(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .catch((err) => {
        err.phase = "fetch_source_playlist";
        throw err;
      });

    const batchUris = (page.data.items || [])
      .map((item) => item?.track?.uri || null)
      .filter(Boolean);
    const merged = [...acc, ...batchUris];

    return fetchPlaylistItemsPageUris(accessToken, page.data.next || null, merged);
  };

  const appendTracksToPlaylist = async (
    accessToken,
    targetPlaylistId,
    uris,
    offset = 0
  ) => {
    if (offset >= uris.length) return;

    const chunk = uris.slice(offset, offset + 100);

    await axios
      .post(
        `${config.SPOTIFY.API_BASE_URL}/playlists/${targetPlaylistId}/items`,
        { uris: chunk },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      )
      .catch((err) => {
        err.phase = "append_target_playlist";
        throw err;
      });

    return appendTracksToPlaylist(accessToken, targetPlaylistId, uris, offset + 100);
  };

  /* ------------------------------------------------------------------ */

  return {
    exchangeCodeForToken,
    getCurrentUser,
    getQueue,
    addSong,
    findTracks,
    importPlaylist,
  };
};
