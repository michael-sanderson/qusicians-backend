const createSessionService = require("../../../src/services/sessionService");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

describe("sessionService", () => {
  const C = {
    SESSION_PREFIX: "session:",
    SESSION_TTL_SECONDS: 86400,
  };

  const buildService = (redisOverrides = {}) => {
    const store = new Map();
    const redisClient = {
      setEx: jest.fn(async (key, ttl, value) => {
        store.set(key, value);
      }),
      get: jest.fn(async (key) => store.get(key) || null),
      del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
      eval: jest.fn(async () => JSON.stringify({ ok: true, sessionId: "s1" })),
      ...redisOverrides,
    };
    const logger = createLogger();
    const service = createSessionService(redisClient, logger, C, AppError);
    return { service, redisClient, store };
  };

  test("createHostSession persists default queue state", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { service, redisClient, store } = buildService();

    const session = await service.createHostSession({
      sessionId: "s1",
      hostId: "host",
      playlistId: "playlist",
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      "session:s1",
      86400,
      expect.any(String)
    );
    expect(JSON.parse(store.get("session:s1"))).toMatchObject({
      sessionId: "s1",
      createdAt: 1000,
      ttl: 86400,
      guests: [],
      pendingTracks: [],
      confirmedTracks: [],
      trackAttributions: {},
      currentNowPlayingSnapshot: null,
      lastPlayedTrack: null,
    });
    expect(session.guests).toEqual([]);
  });

  test("getSession throws when missing", async () => {
    const { service } = buildService();

    await expect(service.getSession("missing")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  test("joinSession validates display name and avatar data", async () => {
    const { service, redisClient } = buildService({
      eval: jest.fn(async () =>
        JSON.stringify({ ok: true, sessionId: "s1", profileImageUrl: "host.jpg" })
      ),
    });

    await expect(service.joinSession("s1", "   ")).rejects.toMatchObject({
      code: "DISPLAY_NAME_REQUIRED",
    });
    await expect(service.joinSession("s1", "Baz", "not-data-url")).rejects.toMatchObject({
      code: "INVALID_AVATAR_IMAGE",
    });

    await expect(
      service.joinSession("s1", " Baz ", "data:image/png;base64,abc=")
    ).resolves.toEqual({
      sessionId: "s1",
      role: "guest",
      displayName: "Baz",
      avatarDataUrl: "data:image/png;base64,abc=",
      profileImageUrl: "host.jpg",
    });

    expect(redisClient.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: ["session:s1"],
      arguments: expect.arrayContaining(["Baz", JSON.stringify("data:image/png;base64,abc=")]),
    });
  });

  test("appendPendingTrack returns duplicate details without appending", async () => {
    const requestedBy = { name: "Alice", role: "guest" };
    const { service } = buildService({
      eval: jest.fn(async () =>
        JSON.stringify({
          ok: true,
          duplicate: true,
          duplicateReason: "previously_requested",
          existingPendingTrackId: null,
          requestedBy,
        })
      ),
    });

    await expect(
      service.appendPendingTrack("s1", { id: "p1", uri: "spotify:track:1" }, requestedBy)
    ).resolves.toEqual({
      appended: false,
      duplicate: true,
      duplicateReason: "previously_requested",
      existingPendingTrackId: null,
      requestedBy,
    });
  });

  test("endSession is strict when session no longer exists", async () => {
    const { service } = buildService({ del: jest.fn(async () => 0) });

    await expect(service.endSession("s1")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });
});
