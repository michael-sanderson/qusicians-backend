const createSearchService = require("../../../../src/services/spotify/searchService");
const { createLogger } = require("../../helpers/testDoubles");
const AppError = require("../../../../src/errors/AppError");

describe("searchService", () => {
  const buildService = () => {
    const spotifyGateway = { get: jest.fn() };
    const perfMetrics = { increment: jest.fn() };
    const logger = createLogger();
    const service = createSearchService({
      spotifyGateway,
      config: {
        SPOTIFY: { API_BASE_URL: "https://api.spotify.test/v1" },
        SPOTIFY_SEARCH_CACHE: { TTL_MS: 30000, MAX_ENTRIES: 20 },
      },
      logger,
      AppError,
      formatTrack: (track) => ({ title: track.name, uri: track.uri }),
      spotifyAuthHeaders: (accessToken) => ({ Authorization: `Bearer ${accessToken}` }),
      perfMetrics,
    });

    return { service, spotifyGateway, perfMetrics };
  };

  test("dedupes concurrent searches for the same normalized query", async () => {
    const { service, spotifyGateway, perfMetrics } = buildService();
    let resolveSearch;
    spotifyGateway.get.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
    );

    const ensureValidSession = jest.fn(async (session) => session);
    const first = service.findTracks({ accessToken: "token" }, " Drake ", ensureValidSession);
    const second = service.findTracks({ accessToken: "token" }, "drake", ensureValidSession);

    resolveSearch({ data: { tracks: { items: [{ name: "One Dance", uri: "spotify:track:1" }] } } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ title: "One Dance", uri: "spotify:track:1" }],
      [{ title: "One Dance", uri: "spotify:track:1" }],
    ]);

    expect(spotifyGateway.get).toHaveBeenCalledTimes(1);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["search", "dedupe", "hit"]);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["search", "dedupe", "miss"]);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["search", "cache", "miss"]);
  });

  test("serves later identical searches from cache", async () => {
    const { service, spotifyGateway, perfMetrics } = buildService();
    spotifyGateway.get.mockResolvedValue({
      data: { tracks: { items: [{ name: "One Dance", uri: "spotify:track:1" }] } },
    });

    const ensureValidSession = jest.fn(async (session) => session);
    await service.findTracks({ accessToken: "token" }, "drake", ensureValidSession);
    const cached = await service.findTracks({ accessToken: "token" }, "  DRAKE  ", ensureValidSession);

    expect(cached).toEqual([{ title: "One Dance", uri: "spotify:track:1" }]);
    expect(spotifyGateway.get).toHaveBeenCalledTimes(1);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["search", "cache", "hit"]);
  });

  test("rejects blank queries", async () => {
    const { service } = buildService();

    await expect(service.findTracks({}, "   ", jest.fn())).rejects.toMatchObject({
      code: "INVALID_SEARCH_QUERY",
    });
  });
});
