const { normalizeSearchQuery } = require("./searchUtils");
const createSearchCache = require("./searchCache");

module.exports = ({
  spotifyGateway,
  config,
  logger,
  AppError,
  formatTrack,
  spotifyAuthHeaders,
  perfMetrics,
}) => {
  const inFlightSearches = new Map();
  const searchCache = createSearchCache({
    ttlMs: Number(config.SPOTIFY_SEARCH_CACHE?.TTL_MS || 30000),
    maxEntries: Number(config.SPOTIFY_SEARCH_CACHE?.MAX_ENTRIES || 200),
  });

  const findTracks = async (session, query, ensureValidSession) => {
    const q = typeof query === "string" ? query.trim() : query?.q?.trim();
    const normalizedQuery = normalizeSearchQuery(q);

    if (!normalizedQuery) {
      throw new AppError("INVALID_SEARCH_QUERY");
    }

    try {
      const cachedTracks = searchCache.get(normalizedQuery);

      if (cachedTracks) {
        perfMetrics?.increment(["search", "cache", "hit"]);
        logger.info(
          { query: q, normalizedQuery, cache: "hit" },
          "Spotify track search served from cache"
        );
        return cachedTracks;
      }

      const inFlightSearch = inFlightSearches.get(normalizedQuery);

      if (inFlightSearch) {
        perfMetrics?.increment(["search", "dedupe", "hit"]);
        logger.info(
          { query: q, normalizedQuery, cache: "miss", dedupe: "hit" },
          "Spotify track search joined in-flight request"
        );
        return inFlightSearch;
      }

      const searchRequest = (async () => {
        const validSession = await ensureValidSession(session);
        const res = await spotifyGateway.get(
          `${config.SPOTIFY.API_BASE_URL}/search`,
          {
            headers: spotifyAuthHeaders(validSession.accessToken),
            params: { q, type: "track", limit: 50 },
          },
          { operation: "search_tracks", priority: "low" }
        );
        const formattedTracks = res.data.tracks.items.map(formatTrack);

        searchCache.set(normalizedQuery, formattedTracks);
        perfMetrics?.increment(["search", "cache", "miss"]);
        perfMetrics?.increment(["search", "dedupe", "miss"]);
        logger.info(
          { query: q, normalizedQuery, cache: "miss", dedupe: "miss" },
          "Spotify track search successful"
        );
        return formattedTracks;
      })().finally(() => {
        inFlightSearches.delete(normalizedQuery);
      });

      inFlightSearches.set(normalizedQuery, searchRequest);
      return searchRequest;
    } catch (err) {
      logger.error(
        {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
          query: q,
          normalizedQuery,
        },
        "Spotify track search failed"
      );
      perfMetrics?.increment(["search", "failed"]);
      throw err;
    }
  };

  return {
    findTracks,
  };
};
