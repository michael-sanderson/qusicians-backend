const createSpotifyController = require("../../../src/controllers/spotifyController");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

describe("spotifyController", () => {
  const buildRes = () => ({
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  });

  test("loginHandler redirects to Spotify OAuth URL", async () => {
    const controller = createSpotifyController(
      {},
      {},
      (state) => `https://accounts.spotify.test/authorize?state=${state}`,
      { generateAndStoreState: jest.fn(async () => "state-1") },
      {},
      jest.fn(),
      createLogger(),
      AppError
    );
    const res = buildRes();

    await controller.loginHandler({}, res, jest.fn());

    expect(res.redirect).toHaveBeenCalledWith("https://accounts.spotify.test/authorize?state=state-1");
  });

  test("callbackHandler validates state, creates host session, sets cookie, and redirects", async () => {
    process.env.FRONTEND_REDIRECT_URL = "https://www.qusicians.test";
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const spotifyService = {
      exchangeCodeForToken: jest.fn(async () => ({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      })),
      getCurrentUser: jest.fn(async () => ({
        userId: "host",
        profileImageUrl: "host.jpg",
        playlistId: "playlist",
      })),
    };
    const sessionService = { createHostSession: jest.fn(async () => {}) };
    const setSessionCookie = jest.fn();
    const controller = createSpotifyController(
      spotifyService,
      {},
      jest.fn(),
      { verifyAndConsumeState: jest.fn(async () => true) },
      sessionService,
      setSessionCookie,
      createLogger(),
      AppError
    );
    const res = buildRes();

    await controller.callbackHandler(
      { query: { code: "code", state: "state" } },
      res,
      jest.fn()
    );

    expect(sessionService.createHostSession).toHaveBeenCalledWith({
      sessionId: "host-state",
      hostId: "host",
      hostProfileImageUrl: "host.jpg",
      playlistId: "playlist",
      accessToken: "access",
      refreshToken: "refresh",
      accessTokenExpiry: 3601000,
    });
    expect(setSessionCookie).toHaveBeenCalledWith(res, {
      sessionId: "host-state",
      role: "host",
      userId: "host",
      profileImageUrl: "host.jpg",
    });
    expect(res.redirect).toHaveBeenCalledWith("https://www.qusicians.test/dashboard");
  });

  test("addSongHandler passes actor and track metadata to service", async () => {
    const spotifyService = { addSong: jest.fn(async () => ({ success: true })) };
    const controller = createSpotifyController(
      spotifyService,
      {},
      jest.fn(),
      {},
      {},
      jest.fn(),
      createLogger(),
      AppError
    );
    const res = buildRes();

    await controller.addSongHandler(
      {
        session: { sessionId: "s1" },
        userRole: "guest",
        displayName: "Alice",
        avatarDataUrl: "avatar",
        body: { trackUri: "spotify:track:1", track: { title: "Song" } },
      },
      res,
      jest.fn()
    );

    expect(spotifyService.addSong).toHaveBeenCalledWith(
      { sessionId: "s1" },
      "spotify:track:1",
      { role: "guest", userId: undefined, displayName: "Alice", avatarDataUrl: "avatar" },
      { title: "Song" }
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test("importPlaylistHandler is host-only", async () => {
    const controller = createSpotifyController(
      {},
      {},
      jest.fn(),
      {},
      {},
      jest.fn(),
      createLogger(),
      AppError
    );
    const next = jest.fn();

    await controller.importPlaylistHandler({ userRole: "guest", body: {} }, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN_HOST_ONLY" }));
  });
});
