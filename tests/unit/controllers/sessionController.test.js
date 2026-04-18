const createSessionController = require("../../../src/controllers/sessionController");
const { createLogger } = require("../helpers/testDoubles");

describe("sessionController", () => {
  const buildRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  });

  test("currentSessionHandler returns the cookie-scoped current session", () => {
    const controller = createSessionController({}, {}, {}, jest.fn(), jest.fn(), createLogger());
    const res = buildRes();

    controller.currentSessionHandler(
      {
        session: { sessionId: "s1", hostProfileImageUrl: "host.jpg" },
        userRole: "guest",
        displayName: "Alice",
      },
      res
    );

    expect(res.json).toHaveBeenCalledWith({
      sessionId: "s1",
      role: "guest",
      userId: null,
      displayName: "Alice",
      profileImageUrl: "host.jpg",
    });
  });

  test("joinSessionHandler sets the session cookie on successful join", async () => {
    const sessionService = {
      joinSession: jest.fn(async () => ({
        sessionId: "s1",
        role: "guest",
        displayName: "Alice",
        profileImageUrl: "host.jpg",
      })),
    };
    const setSessionCookie = jest.fn();
    const controller = createSessionController(
      sessionService,
      {},
      {},
      setSessionCookie,
      jest.fn(),
      createLogger()
    );
    const res = buildRes();

    await controller.joinSessionHandler(
      { body: { sessionId: "s1", name: "Alice", avatarDataUrl: null } },
      res,
      jest.fn()
    );

    expect(sessionService.joinSession).toHaveBeenCalledWith("s1", "Alice", null);
    expect(setSessionCookie).toHaveBeenCalledWith(res, {
      sessionId: "s1",
      role: "guest",
      displayName: "Alice",
      profileImageUrl: "host.jpg",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test("host leave ends session and broadcasts session-ended", async () => {
    const sessionService = { endSession: jest.fn(async () => true) };
    const realtimeQueueState = { notifySessionEnded: jest.fn() };
    const clearSessionCookie = jest.fn();
    const controller = createSessionController(
      sessionService,
      {},
      realtimeQueueState,
      jest.fn(),
      clearSessionCookie,
      createLogger()
    );
    const res = buildRes();

    await controller.leaveSessionHandler(
      {
        session: { sessionId: "s1", hostId: "host-1" },
        userRole: "host",
        userId: "host-1",
      },
      res,
      jest.fn()
    );

    expect(sessionService.endSession).toHaveBeenCalledWith("s1");
    expect(realtimeQueueState.notifySessionEnded).toHaveBeenCalledWith("s1", "host_ended_session");
    expect(clearSessionCookie).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  test("guest list includes credit state", async () => {
    const creditService = { getCredits: jest.fn(async () => ({ remaining: 2 })) };
    const controller = createSessionController({}, creditService, {}, jest.fn(), jest.fn(), createLogger());
    const res = buildRes();

    await controller.getGuestListHandler(
      {
        session: {
          sessionId: "s1",
          guests: [{ name: "Alice", avatarDataUrl: "avatar" }],
        },
      },
      res,
      jest.fn()
    );

    expect(res.json).toHaveBeenCalledWith({
      guests: [{ name: "Alice", avatarDataUrl: "avatar", creditsRemaining: 2 }],
    });
  });
});

describe("sessionController edge paths", () => {
  const buildRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis() });

  test("joinSessionHandler rejects missing session id and logs duplicate names", async () => {
    const logger = createLogger();
    let controller = createSessionController({}, {}, {}, jest.fn(), jest.fn(), logger);
    const next = jest.fn();
    controller.joinSessionHandler({ body: {} }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_SESSION_ID" }));

    const err = Object.assign(new Error("taken"), { code: "DISPLAY_NAME_TAKEN" });
    controller = createSessionController(
      { joinSession: jest.fn(async () => { throw err; }) },
      {},
      {},
      jest.fn(),
      jest.fn(),
      logger
    );
    await controller.joinSessionHandler({ body: { sessionId: "s1", name: "Alice" } }, buildRes(), next);
    expect(logger.warn).toHaveBeenCalledWith({ sessionId: "s1", name: "Alice" }, "Duplicate display name attempt");
    expect(next).toHaveBeenCalledWith(err);
  });

  test("leaveSessionHandler handles guest leave, anonymous leave, stale leave, and unexpected failure", async () => {
    const clearSessionCookie = jest.fn();
    const res = buildRes();
    let controller = createSessionController(
      { leaveSession: jest.fn(async () => true) },
      {},
      {},
      jest.fn(),
      clearSessionCookie,
      createLogger()
    );

    await controller.leaveSessionHandler({ session: { sessionId: "s1" }, userRole: "guest", displayName: "Alice" }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(204);

    await controller.leaveSessionHandler({ session: { sessionId: "s1" }, userRole: "guest" }, buildRes(), jest.fn());

    const stale = Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" });
    controller = createSessionController(
      { leaveSession: jest.fn(async () => { throw stale; }) },
      {},
      {},
      jest.fn(),
      clearSessionCookie,
      createLogger()
    );
    await controller.leaveSessionHandler({ session: { sessionId: "s1" }, userRole: "guest", displayName: "Alice" }, buildRes(), jest.fn());
    expect(clearSessionCookie).toHaveBeenCalled();

    const boom = new Error("boom");
    const next = jest.fn();
    controller = createSessionController(
      { leaveSession: jest.fn(async () => { throw boom; }) },
      {},
      {},
      jest.fn(),
      clearSessionCookie,
      createLogger()
    );
    await controller.leaveSessionHandler({ session: { sessionId: "s1" }, userRole: "guest", displayName: "Alice" }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  test("getGuestListHandler forwards credit failures", async () => {
    const boom = new Error("credit fail");
    const controller = createSessionController(
      {},
      { getCredits: jest.fn(async () => { throw boom; }) },
      {},
      jest.fn(),
      jest.fn(),
      createLogger()
    );
    const next = jest.fn();

    await controller.getGuestListHandler({ session: { sessionId: "s1", guests: [{ name: "A" }] } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
