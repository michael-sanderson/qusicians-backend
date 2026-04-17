const createSpotifyService = require("../../../src/services/spotifyService");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

const baseConfig = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://api.test/spotify/callback",
  SPOTIFY: {
    API_BASE_URL: "https://api.spotify.test/v1",
    TOKEN_URL: "https://accounts.spotify.test/api/token",
  },
  SPOTIFY_SEARCH_CACHE: { TTL_MS: 30000, MAX_ENTRIES: 100 },
};

const futureExpiry = () => Date.now() + 60_000;

const buildSession = (overrides = {}) => ({
  sessionId: "s1",
  hostId: "host-1",
  hostProfileImageUrl: "host.jpg",
  accessToken: "access",
  refreshToken: "refresh",
  accessTokenExpiry: futureExpiry(),
  playlistId: "playlist-1",
  guests: [{ name: "Alice", avatarDataUrl: "alice.png" }],
  pendingTracks: [],
  confirmedTracks: [],
  trackAttributions: {},
  ...overrides,
});

const buildSpotifyService = (overrides = {}) => {
  const spotifyGateway = {
    get: jest.fn(),
    post: jest.fn(),
    request: jest.fn(),
    ...overrides.spotifyGateway,
  };
  const persisted = [];
  const appendPendingTrack = overrides.appendPendingTrack || jest.fn(async () => ({ appended: true }));
  const removePendingTrack = overrides.removePendingTrack || jest.fn(async () => true);
  const creditService = {
    consumeCredit: jest.fn(async () => ({ allowed: true, remaining: 2 })),
    getCredits: jest.fn(async () => ({ remaining: 2 })),
    grantCredit: jest.fn(async () => ({ remaining: 3 })),
    ...overrides.creditService,
  };
  const perfMetrics = { increment: jest.fn() };
  const logger = createLogger();

  const service = createSpotifyService(
    spotifyGateway,
    baseConfig,
    {},
    overrides.getSession || jest.fn(async () => buildSession()),
    overrides.persistSession || jest.fn(async (session) => persisted.push(session)),
    appendPendingTrack,
    removePendingTrack,
    creditService,
    perfMetrics,
    logger,
    AppError
  );

  return {
    service,
    spotifyGateway,
    appendPendingTrack,
    removePendingTrack,
    creditService,
    perfMetrics,
    logger,
    persisted,
  };
};

describe("spotifyService", () => {
  test("host add bypasses credit consumption", async () => {
    const { service, appendPendingTrack, creditService } = buildSpotifyService();

    await expect(
      service.addSong(buildSession(), "spotify:track:1", { role: "host", userId: "host-1" }, {
        title: "Song",
        artist: "Artist",
      })
    ).resolves.toMatchObject({
      success: true,
      duplicate: false,
      pending: true,
      creditsRemaining: null,
    });

    expect(appendPendingTrack).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ uri: "spotify:track:1", title: "Song" }),
      expect.objectContaining({ role: "host", name: "Host" })
    );
    expect(creditService.consumeCredit).not.toHaveBeenCalled();
    expect(creditService.getCredits).not.toHaveBeenCalled();
  });

  test("guest duplicate add reports duplicate without consuming credits", async () => {
    const appendPendingTrack = jest.fn(async () => ({
      duplicate: true,
      duplicateReason: "pending",
      existingPendingTrackId: "p-existing",
      requestedBy: { name: "Alice", role: "guest" },
    }));
    const { service, creditService } = buildSpotifyService({ appendPendingTrack });

    await expect(
      service.addSong(buildSession(), "spotify:track:1", { role: "guest", displayName: "Alice" })
    ).resolves.toMatchObject({
      success: true,
      duplicate: true,
      duplicateReason: "pending",
      creditsRemaining: 2,
      existingPendingTrackId: "p-existing",
      requestedBy: { name: "Alice", role: "guest", avatarDataUrl: null },
    });

    expect(creditService.getCredits).toHaveBeenCalledWith("s1", {
      role: "guest",
      displayName: "Alice",
    });
    expect(creditService.consumeCredit).not.toHaveBeenCalled();
  });

  test("guest no-credit rejection rolls back pending attribution", async () => {
    const { service, removePendingTrack, creditService } = buildSpotifyService({
      creditService: {
        consumeCredit: jest.fn(async () => ({
          allowed: false,
          remaining: 0,
          nextRefillAt: 12345,
        })),
      },
    });

    await expect(
      service.addSong(buildSession(), "spotify:track:1", { role: "guest", displayName: "Alice" })
    ).rejects.toMatchObject({
      code: "NO_CREDITS",
      creditsRemaining: 0,
      nextRefillAt: 12345,
    });

    expect(creditService.consumeCredit).toHaveBeenCalled();
    expect(removePendingTrack).toHaveBeenCalledWith("s1", expect.any(String));
  });

  test("getQueue uses Spotify queue as confirmed queue and removes confirmed pending tracks", async () => {
    const pendingTrack = {
      id: "pending-1",
      uri: "spotify:track:queued",
      title: "Pending",
      addedBy: { name: "Alice", role: "guest" },
    };
    const session = buildSession({
      pendingTracks: [pendingTrack],
      trackAttributions: {
        "spotify:track:queued": { name: "Alice", role: "guest" },
      },
    });
    const { service, spotifyGateway, persisted } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValue({
      data: {
        currently_playing: {
          name: "Current",
          artists: [{ name: "Artist" }],
          album: { name: "Album", images: [{ url: "current.jpg" }] },
          uri: "spotify:track:current",
        },
        queue: [
          {
            name: "Queued",
            artists: [{ name: "Artist" }],
            album: { name: "Album", images: [{ url: "queued.jpg" }] },
            uri: "spotify:track:queued",
          },
        ],
      },
    });

    await expect(service.getQueue(session)).resolves.toMatchObject({
      upNext: { uri: "spotify:track:queued" },
      confirmedQueue: [{ uri: "spotify:track:queued", addedBy: { name: "Alice", role: "guest" } }],
      pendingQueue: [],
    });

    expect(persisted[persisted.length - 1].pendingTracks).toEqual([]);
  });

  test("flushPendingTracks fairly orders pending tracks before appending to Spotify", async () => {
    const pendingTracks = [
      { id: "a1", uri: "spotify:track:a1", addedBy: { name: "Alice", role: "guest" } },
      { id: "a2", uri: "spotify:track:a2", addedBy: { name: "Alice", role: "guest" } },
      { id: "b1", uri: "spotify:track:b1", addedBy: { name: "Bob", role: "guest" } },
      { id: "c1", uri: "spotify:track:c1", addedBy: { name: "Cara", role: "guest" } },
    ];
    const getSession = jest.fn(async () => buildSession({ pendingTracks }));
    const persistSession = jest.fn(async () => {});
    const { service, spotifyGateway, perfMetrics } = buildSpotifyService({
      getSession,
      persistSession,
    });
    spotifyGateway.post.mockResolvedValue({ data: {} });

    await service.flushPendingTracks("s1");

    expect(spotifyGateway.post).toHaveBeenCalledWith(
      "https://api.spotify.test/v1/playlists/playlist-1/items",
      { uris: ["spotify:track:a1", "spotify:track:b1", "spotify:track:a2", "spotify:track:c1"] },
      expect.any(Object),
      { operation: "append_tracks_to_playlist", priority: "high" }
    );
    expect(persistSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingTracks: expect.arrayContaining([
          expect.objectContaining({ id: "a1", status: "awaiting_position" }),
          expect.objectContaining({ id: "a2", status: "awaiting_position" }),
          expect.objectContaining({ id: "b1", status: "awaiting_position" }),
          expect.objectContaining({ id: "c1", status: "awaiting_position" }),
        ]),
      })
    );
    expect(perfMetrics.increment).toHaveBeenCalledWith(["flush", "completed"]);
  });

  test("importPlaylist accepts URLs, paginates, dedupes, and appends unique tracks", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.get
      .mockResolvedValueOnce({
        data: {
          items: [
            { track: { uri: "spotify:track:1" } },
            { track: { uri: "spotify:track:2" } },
          ],
          next: "next-page-url",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ track: { uri: "spotify:track:2" } }, { track: { uri: "spotify:track:3" } }],
          next: null,
        },
      });
    spotifyGateway.post.mockResolvedValue({ data: {} });

    await expect(
      service.importPlaylist(buildSession(), "https://open.spotify.com/playlist/5d4928dc07074ca6887d2e?si=x")
    ).resolves.toEqual({
      success: true,
      importedCount: 3,
      sourcePlaylistId: "5d4928dc07074ca6887d2e",
    });

    expect(spotifyGateway.post).toHaveBeenCalledWith(
      "https://api.spotify.test/v1/playlists/playlist-1/items",
      { uris: ["spotify:track:1", "spotify:track:2", "spotify:track:3"] },
      expect.any(Object),
      { operation: "append_tracks_to_playlist", priority: "high" }
    );
  });
});

// Additional branch coverage for service edge cases.
describe("spotifyService additional public paths", () => {
  test("exchangeCodeForToken posts OAuth payload and propagates failures", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.request.mockResolvedValueOnce({ data: { access_token: "a" } });

    await expect(service.exchangeCodeForToken("code-1")).resolves.toEqual({ access_token: "a" });
    expect(spotifyGateway.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://accounts.spotify.test/api/token",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      { operation: "oauth_token_exchange", priority: "high" }
    );

    const err = new Error("token fail");
    spotifyGateway.request.mockRejectedValueOnce(err);
    await expect(service.exchangeCodeForToken("bad-code")).rejects.toBe(err);
  });

  test("getCurrentUser reuses existing playlist or creates one", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.get
      .mockResolvedValueOnce({ data: { id: "host", images: [{ url: "host.jpg" }] } })
      .mockResolvedValueOnce({ data: { items: [{ name: "Qusicians", id: "existing" }] } });

    await expect(service.getCurrentUser("access")).resolves.toEqual({
      userId: "host",
      profileImageUrl: "host.jpg",
      playlistId: "existing",
    });
    expect(spotifyGateway.post).not.toHaveBeenCalled();

    spotifyGateway.get
      .mockResolvedValueOnce({ data: { id: "host2", images: [{ url: "art.jpg" }] } })
      .mockResolvedValueOnce({ data: { items: [] } });
    spotifyGateway.post.mockResolvedValueOnce({ data: { id: "created" } });

    await expect(service.getCurrentUser("access")).resolves.toEqual({
      userId: "host2",
      profileImageUrl: "art.jpg",
      playlistId: "created",
    });
    expect(spotifyGateway.post).toHaveBeenCalledWith(
      "https://api.spotify.test/v1/users/host2/playlists",
      { name: "Qusicians", public: false },
      expect.any(Object),
      { operation: "create_qusicians_playlist", priority: "normal" }
    );
  });

  test("getCurrentUser propagates upstream failures", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    const err = new Error("me failed");
    spotifyGateway.get.mockRejectedValueOnce(err);

    await expect(service.getCurrentUser("access")).rejects.toBe(err);
  });

  test("getQueue refreshes expired token and grants guest credit on track transition", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const previous = {
      title: "Old",
      artist: "Artist",
      album: "Album",
      artwork: "old.jpg",
      uri: "spotify:track:old",
      addedBy: { name: "Alice", role: "guest" },
    };
    const session = buildSession({
      accessTokenExpiry: 0,
      currentNowPlayingSnapshot: previous,
      trackAttributions: {
        "spotify:track:new": { name: "Bob", role: "guest" },
      },
    });
    const { service, spotifyGateway, creditService, persisted } = buildSpotifyService();
    spotifyGateway.request.mockResolvedValueOnce({ data: { access_token: "new-access", expires_in: 10 } });
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: {
          name: "New",
          artists: [{ name: "Artist" }],
          album: { name: "Album", images: [{ url: "new.jpg" }] },
          uri: "spotify:track:new",
        },
        queue: [],
      },
    });

    await expect(service.getQueue(session)).resolves.toMatchObject({
      nowPlaying: { uri: "spotify:track:new", addedBy: { name: "Bob", role: "guest" } },
      lastPlayed: previous,
    });

    expect(creditService.grantCredit).toHaveBeenCalledWith("s1", {
      role: "guest",
      displayName: "Alice",
    });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accessToken: "new-access", accessTokenExpiry: 11000 }),
        expect.objectContaining({ currentNowPlayingSnapshot: expect.objectContaining({ uri: "spotify:track:new" }) }),
      ])
    );
  });

  test("getQueue wraps upstream queue failures", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    const err = Object.assign(new Error("queue fail"), { response: { status: 503, data: { error: true } } });
    spotifyGateway.get.mockRejectedValueOnce(err);

    await expect(service.getQueue(buildSession())).rejects.toBe(err);
  });

  test("addSong validates track URI and consumes guest credits on accepted pending add", async () => {
    const { service, creditService } = buildSpotifyService();

    await expect(service.addSong(buildSession(), "", { role: "guest", displayName: "Alice" })).rejects.toMatchObject({
      code: "INVALID_TRACK_URI",
    });

    await expect(
      service.addSong(buildSession(), "spotify:track:2", { role: "guest", displayName: "Alice" })
    ).resolves.toMatchObject({ pending: true, creditsRemaining: 2 });
    expect(creditService.consumeCredit).toHaveBeenCalledWith("s1", {
      role: "guest",
      displayName: "Alice",
    });
  });

  test("flushPendingTracks handles empty, already-flushed, empty-uri, and append failure cases", async () => {
    const noPendingGetSession = jest.fn(async () => buildSession({ pendingTracks: [] }));
    let built = buildSpotifyService({ getSession: noPendingGetSession });
    await built.service.flushPendingTracks("s1");
    expect(built.spotifyGateway.post).not.toHaveBeenCalled();

    built = buildSpotifyService({
      getSession: jest.fn(async () => buildSession({ pendingTracks: [{ id: "p1", uri: "u", status: "awaiting_position" }] })),
    });
    await built.service.flushPendingTracks("s1");
    expect(built.spotifyGateway.post).not.toHaveBeenCalled();

    const persistSession = jest.fn(async () => {});
    built = buildSpotifyService({
      getSession: jest.fn(async () => buildSession({ pendingTracks: [{ id: "p1", uri: "", status: "pending" }] })),
      persistSession,
    });
    await built.service.flushPendingTracks("s1");
    expect(persistSession).toHaveBeenCalledWith(expect.objectContaining({
      pendingTracks: [expect.objectContaining({ id: "p1", status: "awaiting_position" })],
    }));

    const appendErr = new Error("append fail");
    built = buildSpotifyService({
      getSession: jest.fn(async () => buildSession({ pendingTracks: [{ id: "p1", uri: "u", status: "pending" }] })),
      spotifyGateway: { post: jest.fn(async () => { throw appendErr; }) },
    });
    await expect(built.service.flushPendingTracks("s1")).resolves.toBeUndefined();
    expect(built.perfMetrics.increment).toHaveBeenCalledWith(["flush", "failed"]);
  });

  test("importPlaylist maps invalid IDs and Spotify upstream statuses", async () => {
    const { service, spotifyGateway } = buildSpotifyService();

    await expect(service.importPlaylist(buildSession(), "bad")).rejects.toMatchObject({ code: "INVALID_PLAYLIST_ID" });

    const statusCases = [
      [404, "fetch_source_playlist", "PLAYLIST_NOT_FOUND"],
      [404, "append_target_playlist", "SPOTIFY_ADD_FAILED"],
      [403, "fetch_source_playlist", "PLAYLIST_ACCESS_DENIED"],
      [429, "fetch_source_playlist", "SPOTIFY_RATE_LIMITED"],
    ];

    for (const [status, phase, code] of statusCases) {
      const err = Object.assign(new Error("spotify import fail"), { response: { status }, phase });
      spotifyGateway.get.mockReset();
      spotifyGateway.post.mockReset();

      if (phase === "fetch_source_playlist") {
        spotifyGateway.get.mockRejectedValueOnce(err);
      } else {
        spotifyGateway.get.mockResolvedValueOnce({ data: { items: [{ track: { uri: "u" } }], next: null } });
        spotifyGateway.post.mockRejectedValueOnce(err);
      }

      await expect(service.importPlaylist(buildSession(), "5d4928dc07074ca6887d2e")).rejects.toMatchObject({ code });
    }
  });

  test("importPlaylist returns zero when source playlist has no tracks", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({ data: { items: [{ track: null }], next: null } });

    await expect(service.importPlaylist(buildSession(), "5d4928dc07074ca6887d2e")).resolves.toEqual({
      success: true,
      importedCount: 0,
      sourcePlaylistId: "5d4928dc07074ca6887d2e",
    });
    expect(spotifyGateway.post).not.toHaveBeenCalled();
  });
});

// Extra branch coverage for queue reconciliation/import edge paths.
describe("spotifyService queue and import branch coverage", () => {
  test("findTracks delegates through the embedded search service", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({
      data: { tracks: { items: [{ name: "Song", artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "art.jpg" }] }, uri: "spotify:track:s" }] } },
    });

    await expect(service.findTracks(buildSession(), " song ")).resolves.toEqual([
      expect.objectContaining({ title: "Song", uri: "spotify:track:s" }),
    ]);
  });

  test("expired token refresh failures are logged and propagated", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    const err = new Error("refresh failed");
    spotifyGateway.request.mockRejectedValueOnce(err);

    await expect(service.getQueue(buildSession({ accessTokenExpiry: 0 }))).rejects.toBe(err);
  });

  test("getQueue handles host/unknown/no-uri transitions, pending misses, and confirmed pruning", async () => {
    jest.spyOn(Date, "now").mockReturnValue(10_000);
    const previousHost = { uri: "spotify:track:old-host", addedBy: { role: "host", name: "Host" } };
    const oldConfirmed = { uri: "spotify:track:staged", confirmedAt: 0 };
    const { service, spotifyGateway, creditService, persisted } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: null,
        queue: [
          { name: "Queued", artists: [{ name: "A" }], album: { name: "B", images: [{ url: "art.jpg" }] }, uri: "spotify:track:queue" },
        ],
      },
    });

    await expect(service.getQueue(buildSession({
      currentNowPlayingSnapshot: previousHost,
      confirmedTracks: [oldConfirmed],
      pendingTracks: [{ id: "p1", uri: "spotify:track:missing", addedBy: "Alice" }],
    }))).resolves.toMatchObject({
      nowPlaying: expect.objectContaining({ uri: "spotify:track:queue" }),
      pendingQueue: [expect.objectContaining({ uri: "spotify:track:missing", status: "pending" })],
      lastPlayed: previousHost,
    });

    expect(creditService.grantCredit).not.toHaveBeenCalled();
    expect(persisted.at(-1)).toMatchObject({ confirmedTracks: [oldConfirmed] });
  });

  test("getQueue logs but continues when play-based guest credit grant fails", async () => {
    const previous = { uri: "spotify:track:old", addedBy: { role: "guest", name: "Alice" } };
    const creditErr = new Error("credit redis down");
    const { service, spotifyGateway, logger } = buildSpotifyService({
      creditService: { grantCredit: jest.fn(async () => { throw creditErr; }) },
    });
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: { name: "New", artists: [{ name: "A" }], album: { name: "B", images: [{ url: "art.jpg" }] }, uri: "spotify:track:new" },
        queue: [],
      },
    });

    await expect(service.getQueue(buildSession({ currentNowPlayingSnapshot: previous }))).resolves.toMatchObject({
      nowPlaying: expect.objectContaining({ uri: "spotify:track:new" }),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: creditErr, sessionId: "s1", trackUri: "spotify:track:old" },
      "Failed to grant play-based credit"
    );
  });

  test("getQueue reconciles pending tracks that appear in Spotify queue", async () => {
    const { service, spotifyGateway, persisted } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: null,
        queue: [{ name: "Pending", artists: [{ name: "A" }], album: { name: "B", images: [{ url: "art.jpg" }] }, uri: "spotify:track:p" }],
      },
    });

    await expect(service.getQueue(buildSession({
      pendingTracks: [{ id: "p1", uri: "spotify:track:p", addedBy: { name: "Alice", role: "guest" } }],
    }))).resolves.toMatchObject({ pendingQueue: [] });
    expect(persisted.at(-1)).toMatchObject({ pendingTracks: [] });
  });

  test("importPlaylist paginates source playlist and propagates unmapped upstream failures", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    spotifyGateway.get
      .mockResolvedValueOnce({ data: { items: [{ track: { uri: "spotify:track:1" } }], next: "https://next.test/page2" } })
      .mockResolvedValueOnce({ data: { items: [{ track: { uri: "spotify:track:2" } }], next: null } });
    spotifyGateway.post.mockResolvedValueOnce({ data: {} });

    await expect(service.importPlaylist(buildSession(), "spotify:playlist:5d4928dc07074ca6887d2e")).resolves.toEqual({
      success: true,
      importedCount: 2,
      sourcePlaylistId: "5d4928dc07074ca6887d2e",
    });
    expect(spotifyGateway.get).toHaveBeenNthCalledWith(2, "https://next.test/page2", expect.any(Object), {
      operation: "fetch_source_playlist_page",
      priority: "low",
    });

    const unmapped = Object.assign(new Error("bad gateway"), { response: { status: 500 } });
    spotifyGateway.get.mockReset();
    spotifyGateway.post.mockReset();
    spotifyGateway.get.mockRejectedValueOnce(unmapped);
    await expect(service.importPlaylist(buildSession(), "5d4928dc07074ca6887d2e")).rejects.toBe(unmapped);
  });
});






  test("getQueue ignores uncreditable previous tracks", async () => {
    const previous = { uri: "spotify:track:old", addedBy: { role: "mystery", name: "Nobody" } };
    const { service, spotifyGateway, creditService } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: { name: "New", artists: [{ name: "A" }], album: { name: "B", images: [{ url: "art.jpg" }] }, uri: "spotify:track:new" },
        queue: [],
      },
    });

    await expect(service.getQueue(buildSession({ currentNowPlayingSnapshot: previous }))).resolves.toMatchObject({
      nowPlaying: expect.objectContaining({ uri: "spotify:track:new" }),
    });
    expect(creditService.grantCredit).not.toHaveBeenCalled();
  });

  test("importPlaylist handles no-status failures and paginated source failures", async () => {
    const { service, spotifyGateway } = buildSpotifyService();
    const noStatus = new Error("network down");
    spotifyGateway.get.mockRejectedValueOnce(noStatus);
    await expect(service.importPlaylist(buildSession(), "5d4928dc07074ca6887d2e")).rejects.toBe(noStatus);

    const pageErr = Object.assign(new Error("page failed"), { response: { status: 500 } });
    spotifyGateway.get.mockReset();
    spotifyGateway.get
      .mockResolvedValueOnce({ data: { items: [{ track: { uri: "spotify:track:1" } }], next: "https://next.test/page2" } })
      .mockRejectedValueOnce(pageErr);
    await expect(service.importPlaylist(buildSession(), "5d4928dc07074ca6887d2e")).rejects.toBe(pageErr);
    expect(pageErr.phase).toBe("fetch_source_playlist");
  });

  test("getQueue handles guest attribution without a display name and visible tracks without URIs", async () => {
    const previous = { uri: "spotify:track:old", addedBy: { role: "guest", name: "   " } };
    const { service, spotifyGateway, creditService } = buildSpotifyService();
    spotifyGateway.get.mockResolvedValueOnce({
      data: {
        currently_playing: { name: "No URI", artists: [{ name: "A" }], album: { name: "B", images: [{ url: "art.jpg" }] } },
        queue: [],
      },
    });

    await expect(service.getQueue(buildSession({ currentNowPlayingSnapshot: previous }))).resolves.toMatchObject({
      nowPlaying: expect.objectContaining({ title: "No URI" }),
    });
    expect(creditService.grantCredit).not.toHaveBeenCalled();
  });

  test("flushPendingTracks ignores concurrent in-flight flushes", async () => {
    let resolvePost;
    const getSession = jest.fn(async () => buildSession({ pendingTracks: [{ id: "p1", uri: "spotify:track:1", status: "pending" }] }));
    const { service, spotifyGateway } = buildSpotifyService({
      getSession,
      spotifyGateway: { post: jest.fn(() => new Promise((resolve) => { resolvePost = resolve; })) },
    });

    const first = service.flushPendingTracks("s1");
    await Promise.resolve();
    await service.flushPendingTracks("s1");
    expect(getSession).toHaveBeenCalledTimes(1);
    resolvePost({ data: {} });
    await first;
    expect(spotifyGateway.post).toHaveBeenCalledTimes(1);
  });
