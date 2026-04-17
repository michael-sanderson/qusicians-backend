const createRequireSession = require("../../../src/middleware/requireSession");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

describe("requireSession middleware", () => {
  const buildReq = (cookie = "raw-cookie") => ({ cookies: { partySession: cookie } });
  const res = {};

  test("attaches parsed cookie identity and loaded session", async () => {
    const session = { sessionId: "s1", hostId: "host" };
    const parseSessionCookie = jest.fn(() => ({
      ok: true,
      sessionId: "s1",
      role: "guest",
      displayName: "Alice",
      avatarDataUrl: "avatar",
    }));
    const sessionService = { getSession: jest.fn(async () => session) };
    const req = buildReq();
    const next = jest.fn();

    await createRequireSession(parseSessionCookie, sessionService, createLogger(), AppError)(req, res, next);

    expect(req.session).toBe(session);
    expect(req.userRole).toBe("guest");
    expect(req.displayName).toBe("Alice");
    expect(req.avatarDataUrl).toBe("avatar");
    expect(next).toHaveBeenCalledWith();
  });

  test.each([
    ["Missing session cookie", "SESSION_COOKIE_MISSING"],
    ["Invalid session cookie", "SESSION_COOKIE_INVALID"],
    ["Malformed session cookie", "SESSION_COOKIE_MALFORMED"],
  ])("maps parse failure %s to %s", async (parseError, expectedCode) => {
    const parseSessionCookie = jest.fn(() => ({ ok: false, error: parseError }));
    const next = jest.fn();

    await createRequireSession(parseSessionCookie, {}, createLogger(), AppError)(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: expectedCode }));
  });

  test("maps missing redis session to invalid/expired", async () => {
    const parseSessionCookie = jest.fn(() => ({ ok: true, sessionId: "s1" }));
    const sessionService = {
      getSession: jest.fn(async () => {
        throw new AppError("SESSION_NOT_FOUND");
      }),
    };
    const next = jest.fn();

    await createRequireSession(parseSessionCookie, sessionService, createLogger(), AppError)(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_INVALID_OR_EXPIRED" }));
  });
});
