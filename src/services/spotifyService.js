// services/spotifyService.js
//
// Spotify API boundary.
// Ensures all Spotify calls run with a valid access token.

module.exports = (
  spotifyGateway,
  config,
  realtimeQueueState,
  getSession,
  persistSession,
  appendPendingTrack,
  removePendingTrack,
  creditService,
  perfMetrics,
  logger,
  AppError
) => {
  const {
    resolveAddedBy,
    normalizeAddedBy,
    normalizeAttributions,
    resolveGuestByName,
  } = require("./spotify/attributionUtils");
  const {
    formatTrack,
    normalizeTrackMeta,
    resolvePlaylistId,
  } = require("./spotify/trackUtils");
  const createSearchService = require("./spotify/searchService");

  const CONFIRMED_TRACK_RETENTION_MS = 20 * 60 * 1000;
  const MAX_STAGED_CONFIRMED_TRACKS = 200;
  const flushStateBySession = new Map();
  const spotifyAuthHeaders = (accessToken, extraHeaders = {}) => ({
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  });
  const searchService = createSearchService({
    spotifyGateway,
    config,
    logger,
    AppError,
    formatTrack,
    spotifyAuthHeaders,
    perfMetrics,
  });
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

      const res = await spotifyGateway.request(
        {
          method: "POST",
          url: config.SPOTIFY.TOKEN_URL,
          data: payload,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        { operation: "oauth_token_exchange", priority: "high" }
      );

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
      const userRes = await spotifyGateway.get(
        `${config.SPOTIFY.API_BASE_URL}/me`,
        {
          headers: spotifyAuthHeaders(accessToken),
        },
        { operation: "fetch_current_user", priority: "normal" }
      );

      const userId = userRes.data.id;
      const profileImageUrl = userRes.data.images?.[0]?.url || null;

      logger.debug({ userId }, "Fetched current Spotify user");

      // 2) Fetch the user's playlists
      const playlistsRes = await spotifyGateway.get(
        `${config.SPOTIFY.API_BASE_URL}/me/playlists?limit=50`,
        { headers: spotifyAuthHeaders(accessToken) },
        { operation: "fetch_user_playlists", priority: "normal" }
      );

      const existingPlaylist = playlistsRes.data.items.find(
        (p) => p.name === "Qusicians"
      );

      // 3) Reuse existing playlist or create a new one
      const playlist = existingPlaylist
        ? existingPlaylist
        : (
            await spotifyGateway.post(
              `${config.SPOTIFY.API_BASE_URL}/users/${userId}/playlists`,
              { name: "Qusicians", public: false },
              { headers: spotifyAuthHeaders(accessToken) },
              { operation: "create_qusicians_playlist", priority: "normal" }
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
      const normalizedSession = ensureTrackQueueState(validSession);

      const res = await spotifyGateway.get(
        `${config.SPOTIFY.API_BASE_URL}/me/player/queue`,
        {
          headers: spotifyAuthHeaders(validSession.accessToken),
        },
        { operation: "fetch_queue_snapshot", priority: "high" }
      );

      const { currently_playing, queue } = res.data;
      const nowPlayingTrack = formatTrack(currently_playing);
      const queueTracks = queue.map(formatTrack);
      const trackAttributions = normalizeAttributions(
        normalizedSession.trackAttributions
      );
      const decorated = decorateWithAttribution(
        nowPlayingTrack,
        queueTracks,
        trackAttributions
      );
      const previousSnapshot = normalizedSession.currentNowPlayingSnapshot || null;
      const previousUri = previousSnapshot?.uri || null;
      const currentUri = decorated.nowPlaying?.uri || null;
      const hasTrackTransition = previousUri !== currentUri;
      const lastPlayedTrack =
        hasTrackTransition && previousSnapshot?.uri
          ? previousSnapshot
          : normalizedSession.lastPlayedTrack || null;

      const cleanedConfirmedTracks = pruneStagedConfirmedTracks(
        normalizedSession.confirmedTracks,
        decorated
      );
      const pendingReconciliation = reconcilePendingTracksWithSpotifyQueue(
        normalizedSession.pendingTracks,
        decorated
      );
      const pendingQueue = normalizePendingTracksForClient(
        pendingReconciliation.pendingTracks
      );
      const confirmedQueue = decorated.queue;

      const shouldPersistQueueState =
        cleanedConfirmedTracks.length !==
          (normalizedSession.confirmedTracks || []).length ||
        pendingReconciliation.changed;

      if (hasTrackTransition || shouldPersistQueueState) {
        await grantCreditForPlayedTrack(validSession, previousSnapshot);

        await persistSession({
          ...normalizedSession,
          pendingTracks: pendingReconciliation.pendingTracks,
          confirmedTracks: cleanedConfirmedTracks,
          currentNowPlayingSnapshot: decorated.nowPlaying || null,
          lastPlayedTrack,
        });
      }

      return {
        nowPlaying: decorated.nowPlaying,
        upNext: confirmedQueue[0] ?? null,
        queue: confirmedQueue,
        pendingQueue,
        confirmedQueue,
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
  const addSong = async (session, trackUri, actor = {}, trackMeta = null) => {
    if (!trackUri || typeof trackUri !== "string") {
      throw new AppError("INVALID_TRACK_URI");
    }

    try {
      const validSession = await ensureValidSession(session);
      const normalizedSession = ensureTrackQueueState(validSession);
      const guest =
        actor?.role === "guest"
          ? resolveGuestByName(normalizedSession.guests, actor.displayName)
          : null;
      const addedBy = resolveAddedBy(actor, guest, normalizedSession.hostProfileImageUrl);
      const normalizedTrackMeta = normalizeTrackMeta(trackMeta);
      const pendingId = buildPendingTrackId();
      const pendingTrack = {
        id: pendingId,
        uri: trackUri,
        title: normalizedTrackMeta?.title || null,
        artist: normalizedTrackMeta?.artist || null,
        album: normalizedTrackMeta?.album || null,
        artwork: normalizedTrackMeta?.artwork || null,
        addedBy,
        requestedAt: Date.now(),
      };
      const appendResult = await appendPendingTrack(
        validSession.sessionId,
        pendingTrack,
        addedBy
      );

      if (appendResult?.duplicate) {
        const credits = await creditService.getCredits(validSession.sessionId, actor);

        return {
          success: true,
          duplicate: true,
          duplicateReason: appendResult.duplicateReason || "pending",
          pending: false,
          creditsRemaining: credits.remaining,
          existingPendingTrackId: appendResult.existingPendingTrackId || null,
          requestedBy: normalizeAddedBy(appendResult.requestedBy),
        };
      }

      const creditResult = await creditService.consumeCredit(validSession.sessionId, actor);

      if (!creditResult.allowed) {
        await removePendingTrack(validSession.sessionId, pendingId);

        const err = new AppError("NO_CREDITS");
        err.nextRefillAt = creditResult.nextRefillAt;
        err.creditsRemaining = creditResult.remaining;
        throw err;
      }

      logger.info({ trackUri }, "Accepted track into pending batch queue");
      return {
        success: true,
        duplicate: false,
        pending: true,
        creditsRemaining: creditResult.remaining,
        pendingTrackId: pendingId,
      };
    } catch (err) {
      logger.error({ err, trackUri }, "Failed to add track to Spotify playlist");
      throw err;
    }
  };

  // Search Spotify tracks.
  const findTracks = (session, query) =>
    searchService.findTracks(session, query, ensureValidSession);

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

      const res = await spotifyGateway.request(
        {
          method: "POST",
          url: config.SPOTIFY.TOKEN_URL,
          data: payload,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        { operation: "refresh_access_token", priority: "high" }
      );

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

  const resolveCreditActorForPlayedTrack = (session, track) => {
    const role = track?.addedBy?.role;

    if (role === "host") {
      return {
        role: "host",
        userId: session.hostId,
      };
    }

    if (role === "guest") {
      const displayName =
        typeof track?.addedBy?.name === "string" ? track.addedBy.name.trim() : "";

      if (!displayName) return null;

      return {
        role: "guest",
        displayName,
      };
    }

    return null;
  };

  const grantCreditForPlayedTrack = async (session, previousSnapshot) => {
    if (!previousSnapshot?.uri) return;

    const actor = resolveCreditActorForPlayedTrack(session, previousSnapshot);
    if (!actor) return;

    try {
      await creditService.grantCredit(session.sessionId, actor);
      logger.debug(
        { sessionId: session.sessionId, role: actor.role, trackUri: previousSnapshot.uri },
        "Granted credit after track transitioned"
      );
    } catch (err) {
      logger.warn(
        { err, sessionId: session.sessionId, trackUri: previousSnapshot.uri },
        "Failed to grant play-based credit"
      );
    }
  };

  const ensureTrackQueueState = (session) => ({
    ...session,
    pendingTracks: Array.isArray(session.pendingTracks) ? session.pendingTracks : [],
    confirmedTracks: Array.isArray(session.confirmedTracks) ? session.confirmedTracks : [],
  });

  const normalizePendingTracksForClient = (pendingTracks = []) =>
    pendingTracks.map((track) => ({
      id: track.id,
      uri: track.uri,
      title: track.title || "Pending track",
      artist: track.artist || "Awaiting Spotify flush",
      album: track.album || "",
      artwork: track.artwork || null,
      addedBy: normalizeAddedBy(track.addedBy),
      status: track.status || "pending",
    }));

  const pruneStagedConfirmedTracks = (confirmedTracks = [], decoratedQueue) => {
    const spotifyUris = new Set(
      [decoratedQueue?.nowPlaying, ...(decoratedQueue?.queue || [])]
        .filter(Boolean)
        .map((track) => track.uri)
    );

    const now = Date.now();
    return confirmedTracks
      .filter((track) => track?.uri && !spotifyUris.has(track.uri))
      .filter((track) => now - (track.confirmedAt || now) <= CONFIRMED_TRACK_RETENTION_MS)
      .slice(-MAX_STAGED_CONFIRMED_TRACKS);
  };

  const reconcilePendingTracksWithSpotifyQueue = (pendingTracks = [], decoratedQueue) => {
    const visibleTracks = [
      decoratedQueue?.nowPlaying,
      ...(decoratedQueue?.queue || []),
    ].filter(Boolean);
    const visibleUriCounts = visibleTracks.reduce((counts, track) => {
      if (!track?.uri) return counts;
      counts.set(track.uri, (counts.get(track.uri) || 0) + 1);
      return counts;
    }, new Map());

    let changed = false;
    const remainingPending = [];

    pendingTracks.forEach((track) => {
      const count = track?.uri ? visibleUriCounts.get(track.uri) || 0 : 0;

      if (count > 0) {
        visibleUriCounts.set(track.uri, count - 1);
        changed = true;
        return;
      }

      remainingPending.push(track);
    });

    return {
      pendingTracks: remainingPending,
      changed,
    };
  };

  const buildPendingTrackId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const getOrCreateFlushState = (sessionId) => {
    const existing = flushStateBySession.get(sessionId);
    if (existing) return existing;

    const state = {
      inFlight: false,
    };
    flushStateBySession.set(sessionId, state);
    return state;
  };

  const flushPendingTracks = async (sessionId) => {
    const state = getOrCreateFlushState(sessionId);
    if (state.inFlight) return;

    state.inFlight = true;
    try {
      const originalSession = await getSession(sessionId);
      const validSession = await ensureValidSession(originalSession);
      const normalized = ensureTrackQueueState(validSession);

      if (normalized.pendingTracks.length === 0) {
        return;
      }

      const flushablePending = normalized.pendingTracks.filter(
        (track) => (track.status || "pending") === "pending"
      );

      if (flushablePending.length === 0) {
        return;
      }

      const chunk = flushablePending.slice();
      const uris = chunk.map((track) => track.uri).filter(Boolean);
      if (uris.length === 0) {
        const updated = {
          ...normalized,
          pendingTracks: normalized.pendingTracks.map((track) =>
            (track.status || "pending") === "pending"
              ? { ...track, status: "awaiting_position", flushedAt: Date.now() }
              : track
          ),
        };
        await persistSession(updated);
        return;
      }

      await appendTracksToPlaylist(
        normalized.accessToken,
        normalized.playlistId,
        uris
      );
      perfMetrics?.increment(["flush", "completed"]);
      perfMetrics?.increment(["flush", "tracks"], chunk.length);

      const flushedIds = new Set(chunk.map((track) => track.id).filter(Boolean));
      const flushedAt = Date.now();
      const nextPendingTracks = normalized.pendingTracks.map((track) =>
        flushedIds.has(track.id)
          ? { ...track, status: "awaiting_position", flushedAt }
          : track
      );

      await persistSession({
        ...normalized,
        pendingTracks: nextPendingTracks,
      });

    } catch (err) {
      perfMetrics?.increment(["flush", "failed"]);
      logger.warn({ err, sessionId }, "Batch flush to Spotify failed");
    } finally {
      const latestState = getOrCreateFlushState(sessionId);
      latestState.inFlight = false;
    }
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
    const firstPage = await spotifyGateway
      .get(
        `${config.SPOTIFY.API_BASE_URL}/playlists/${playlistId}/items`,
        {
          headers: spotifyAuthHeaders(accessToken),
          params: {
            limit: 100,
            fields: "items(track(uri)),next",
          },
        },
        { operation: "fetch_source_playlist_page", priority: "low" }
      )
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

    const page = await spotifyGateway
      .get(
        nextUrl,
        {
          headers: spotifyAuthHeaders(accessToken),
        },
        { operation: "fetch_source_playlist_page", priority: "low" }
      )
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

    await spotifyGateway
      .post(
        `${config.SPOTIFY.API_BASE_URL}/playlists/${targetPlaylistId}/items`,
        { uris: chunk },
        {
          headers: spotifyAuthHeaders(accessToken, {
            "Content-Type": "application/json",
          }),
        },
        { operation: "append_tracks_to_playlist", priority: "high" }
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
    flushPendingTracks,
    findTracks,
    importPlaylist,
  };
};
