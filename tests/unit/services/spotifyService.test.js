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
