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

describe("spotifyController edge paths", () => {
  const buildRes = () => ({ json: jest.fn().mockReturnThis(), redirect: jest.fn().mockReturnThis() });

  test("loginHandler wraps OAuth state generation failure", async () => {
    const err = new Error("state fail");
    const controller = createSpotifyController({}, {}, jest.fn(), { generateAndStoreState: jest.fn(async () => { throw err; }) }, {}, jest.fn(), createLogger(), AppError);
    const next = jest.fn();

    await controller.loginHandler({}, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_OAUTH_INIT_FAILED" }));
  });

  test("callbackHandler validates missing and invalid state and wraps callback failures", async () => {
    let controller = createSpotifyController({}, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    let next = jest.fn();
    await controller.callbackHandler({ query: {} }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "OAUTH_CODE_OR_STATE_MISSING" }));

    controller = createSpotifyController({}, {}, jest.fn(), { verifyAndConsumeState: jest.fn(async () => false) }, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.callbackHandler({ query: { code: "c", state: "s" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "OAUTH_STATE_INVALID" }));

    controller = createSpotifyController(
      { exchangeCodeForToken: jest.fn(async () => { throw new Error("bad token"); }) },
      {},
      jest.fn(),
      { verifyAndConsumeState: jest.fn(async () => true) },
      {},
      jest.fn(),
      createLogger(),
      AppError
    );
    next = jest.fn();
    await controller.callbackHandler({ query: { code: "c", state: "s" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_CALLBACK_FAILED" }));
  });

  test("getQueueHandler returns snapshots and maps realtime errors", async () => {
    let controller = createSpotifyController({}, { ensureFreshSnapshot: jest.fn(async () => ({ queue: [] })) }, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    const res = buildRes();
    await controller.getQueueHandler({ session: { sessionId: "s1" } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ queue: [] });

    let next = jest.fn();
    controller = createSpotifyController({}, { ensureFreshSnapshot: jest.fn(async () => null) }, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    await controller.getQueueHandler({ session: { sessionId: "s1" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "QUEUE_REALTIME_UNAVAILABLE" }));

    const unavailable = Object.assign(new Error("unavailable"), { code: "QUEUE_REALTIME_UNAVAILABLE" });
    next = jest.fn();
    controller = createSpotifyController({}, { ensureFreshSnapshot: jest.fn(async () => { throw unavailable; }) }, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    await controller.getQueueHandler({ session: { sessionId: "s1" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(unavailable);

    next = jest.fn();
    controller = createSpotifyController({}, { ensureFreshSnapshot: jest.fn(async () => { throw new Error("boom"); }) }, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    await controller.getQueueHandler({ session: { sessionId: "s1" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_QUEUE_FETCH_FAILED" }));
  });

  test("add/search/import handlers pass through known errors and wrap unknown errors", async () => {
    const knownAdd = Object.assign(new Error("invalid"), { code: "INVALID_TRACK_URI" });
    let controller = createSpotifyController({ addSong: jest.fn(async () => { throw knownAdd; }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    let next = jest.fn();
    await controller.addSongHandler({ session: {}, body: {}, userRole: "guest" }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(knownAdd);

    controller = createSpotifyController({ addSong: jest.fn(async () => { throw new Error("unknown"); }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.addSongHandler({ session: {}, body: {}, userRole: "guest" }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_ADD_FAILED" }));

    const invalidSearch = Object.assign(new Error("invalid"), { code: "INVALID_SEARCH_QUERY" });
    controller = createSpotifyController({ findTracks: jest.fn(async () => { throw invalidSearch; }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.findTracksHandler({ session: {}, query: {} }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(invalidSearch);

    controller = createSpotifyController({ findTracks: jest.fn(async () => { throw new Error("search fail"); }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.findTracksHandler({ session: {}, query: {} }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_SEARCH_FAILED" }));

    const importKnown = Object.assign(new Error("private"), { code: "PLAYLIST_ACCESS_DENIED" });
    controller = createSpotifyController({ importPlaylist: jest.fn(async () => { throw importKnown; }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.importPlaylistHandler({ userRole: "host", session: {}, body: { playlistId: "p" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(importKnown);

    controller = createSpotifyController({ importPlaylist: jest.fn(async () => { throw new Error("bad"); }) }, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);
    next = jest.fn();
    await controller.importPlaylistHandler({ userRole: "host", session: {}, body: { playlistId: "p" } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SPOTIFY_ADD_FAILED" }));
  });
});

  test("successful search and import handlers write json responses", async () => {
    const spotifyService = {
      findTracks: jest.fn(async () => [{ uri: "spotify:track:1" }]),
      importPlaylist: jest.fn(async () => ({ success: true, importedCount: 1 })),
    };
    const controller = createSpotifyController(spotifyService, {}, jest.fn(), {}, {}, jest.fn(), createLogger(), AppError);

    let res = { json: jest.fn() };
    await controller.findTracksHandler({ session: { sessionId: "s1" }, query: { q: "drake" } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith([{ uri: "spotify:track:1" }]);

    res = { json: jest.fn() };
    await controller.importPlaylistHandler(
      { userRole: "host", session: { sessionId: "s1" }, body: { playlistId: "5d4928dc07074ca6887d2e" } },
      res,
      jest.fn()
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, importedCount: 1 });
  });

