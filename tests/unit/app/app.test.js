const request = require("supertest");
const createApp = require("../../../src/app");
const createErrorResponder = require("../../../src/middleware/errorResponder");
const { toHttpErrorFactory } = require("../../../src/errors");
const ERROR_CATALOG = require("../../../src/errors/errorCatalog");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

const buildApp = ({ requireSession = null, sessionController = {}, spotifyController = {} } = {}) => {
  const logger = createLogger();
  return createApp({
    perfMetrics: { enabled: false, increment: jest.fn(), timing: jest.fn(), gauge: jest.fn() },
    requestLogger: (req, res, next) => next(),
    requireSession:
      requireSession ||
      ((req, res, next) => {
        req.session = { sessionId: "s1", hostId: "host-1", hostProfileImageUrl: "host.jpg" };
        req.userRole = "guest";
        req.displayName = "Alice";
        next();
      }),
    sessionController: {
      currentSessionHandler: (req, res) => res.json({ sessionId: req.session.sessionId }),
      joinSessionHandler: (req, res) => res.json({ success: true }),
      leaveSessionHandler: (req, res) => res.status(204).end(),
      getGuestListHandler: (req, res) => res.json({ guests: [] }),
      ...sessionController,
    },
    spotifyController: {
      loginHandler: (req, res) => res.redirect("https://accounts.spotify.test"),
      callbackHandler: (req, res) => res.redirect("/dashboard"),
      getQueueHandler: (req, res) => res.json({ queue: [] }),
      findTracksHandler: (req, res) => res.json([]),
      addSongHandler: (req, res) => res.json({ success: true }),
      importPlaylistHandler: (req, res) => res.json({ success: true }),
      ...spotifyController,
    },
    errorResponder: createErrorResponder(toHttpErrorFactory(ERROR_CATALOG), logger),
  });
};

describe("app routes", () => {
  test("GET /session/current uses session middleware", async () => {
    await request(buildApp())
      .get("/session/current")
      .expect(200)
      .expect({ sessionId: "s1" });
  });

  test("protected route returns structured error when session is missing", async () => {
    const app = buildApp({
      requireSession: (req, res, next) => next(new AppError("SESSION_COOKIE_MISSING")),
    });

    await request(app)
      .get("/spotify/queue")
      .expect(401)
      .expect({ error: "Missing session cookie", code: "SESSION_COOKIE_MISSING" });
  });

  test("POST /spotify/import-playlist passes through controller result", async () => {
    await request(buildApp({
      spotifyController: {
        importPlaylistHandler: (req, res) => res.json({ success: true, importedCount: 3 }),
      },
    }))
      .post("/spotify/import-playlist")
      .send({ playlistId: "5d4928dc07074ca6887d2e" })
      .expect(200)
      .expect({ success: true, importedCount: 3 });
  });

  test("unknown routes return 404 text fallback", async () => {
    await request(buildApp()).get("/does-not-exist").expect(404).expect("Not found");
  });
});
