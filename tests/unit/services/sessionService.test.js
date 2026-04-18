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

describe("sessionService additional edge cases", () => {
  const C = { SESSION_PREFIX: "session:", SESSION_TTL_SECONDS: 86400 };
  const makeService = (evalResult) => {
    const redisClient = {
      get: jest.fn(async () => JSON.stringify({ sessionId: "s1" })),
      setEx: jest.fn(async () => {}),
      del: jest.fn(async () => 1),
      eval: jest.fn(async () => JSON.stringify(evalResult)),
    };
    return { service: createSessionService(redisClient, createLogger(), C, AppError), redisClient };
  };

  test("joinSession maps script failure codes and default missing profile image", async () => {
    let built = makeService({ ok: false, code: "DISPLAY_NAME_TAKEN" });
    await expect(built.service.joinSession("s1", "Alice")).rejects.toMatchObject({ code: "DISPLAY_NAME_TAKEN" });

    built = makeService({ ok: true, sessionId: "s1" });
    await expect(built.service.joinSession("s1", "Alice", "   ")).resolves.toMatchObject({
      profileImageUrl: null,
      avatarDataUrl: null,
    });
  });

  test("leaveSession maps missing session and succeeds otherwise", async () => {
    let built = makeService({ ok: false });
    await expect(built.service.leaveSession("s1", "Alice")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });

    built = makeService({ ok: true });
    await expect(built.service.leaveSession("s1", "Alice")).resolves.toBe(true);
  });

  test("appendPendingTrack success and missing session", async () => {
    let built = makeService({ ok: false });
    await expect(built.service.appendPendingTrack("s1", { uri: "u" }, { name: "A" })).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });

    built = makeService({ ok: true, duplicate: false });
    await expect(built.service.appendPendingTrack("s1", { id: "p", uri: "u" }, { name: "A" })).resolves.toEqual({
      appended: true,
      duplicate: false,
    });
  });

  test("removePendingTrack success, false removal, and missing session", async () => {
    let built = makeService({ ok: false });
    await expect(built.service.removePendingTrack("s1", "p1")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });

    built = makeService({ ok: true, removed: false });
    await expect(built.service.removePendingTrack("s1", "p1")).resolves.toBe(false);

    built = makeService({ ok: true, removed: true });
    await expect(built.service.removePendingTrack("s1", "p1")).resolves.toBe(true);
  });

  test("endSession succeeds and persistSession uses default ttl", async () => {
    const built = makeService({ ok: true });
    await expect(built.service.endSession("s1")).resolves.toBe(true);
    await expect(built.service.persistSession({ sessionId: "s2" })).resolves.toEqual({ sessionId: "s2" });
    expect(built.redisClient.setEx).toHaveBeenCalledWith("session:s2", 86400, JSON.stringify({ sessionId: "s2" }));
  });

  test("avatar normalization rejects too-large and non-string inputs", async () => {
    const built = makeService({ ok: true, sessionId: "s1" });
    await expect(built.service.joinSession("s1", "Alice", {})).rejects.toMatchObject({ code: "INVALID_AVATAR_IMAGE" });
    await expect(built.service.joinSession("s1", "Alice", `data:image/png;base64,${"a".repeat(512001)}`)).rejects.toMatchObject({
      code: "AVATAR_IMAGE_TOO_LARGE",
    });
  });
});

  test("getSession returns stored JSON and joinSession rejects non-string names", async () => {
    const store = new Map([["session:s1", JSON.stringify({ sessionId: "s1", hostId: "h" })]]);
    const redisClient = {
      get: jest.fn(async (key) => store.get(key) || null),
      setEx: jest.fn(),
      del: jest.fn(),
      eval: jest.fn(),
    };
    const service = createSessionService(redisClient, createLogger(), { SESSION_PREFIX: "session:", SESSION_TTL_SECONDS: 86400 }, AppError);

    await expect(service.getSession("s1")).resolves.toEqual({ sessionId: "s1", hostId: "h" });
    await expect(service.joinSession("s1", null)).rejects.toMatchObject({ code: "DISPLAY_NAME_REQUIRED" });
  });

