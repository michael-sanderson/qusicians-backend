describe("bootstrap dependencies", () => {
  const loadWithMocks = (env = {}) => {
    jest.resetModules();
    const oldEnv = { ...process.env };
    Object.assign(process.env, env);

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const redisClient = { get: jest.fn(), setEx: jest.fn(), eval: jest.fn() };
    const sessionService = {
      getSession: jest.fn(),
      persistSession: jest.fn(),
      appendPendingTrack: jest.fn(),
      removePendingTrack: jest.fn(),
    };
    const oauthStateService = { generateAndStoreState: jest.fn(), verifyAndConsumeState: jest.fn() };
    const creditService = { consumeCredit: jest.fn(), getCredits: jest.fn(), grantCredit: jest.fn() };
    const spotifyGateway = { request: jest.fn(), get: jest.fn(), post: jest.fn() };
    const spotifyService = { getQueue: jest.fn(), addSong: jest.fn() };
    const requireSession = jest.fn();
    const errorResponder = jest.fn();
    const sessionController = { joinSessionHandler: jest.fn() };
    const spotifyController = { loginHandler: jest.fn() };
    const requestLogger = jest.fn();
    const perfMetrics = { enabled: env.PERF_METRICS === "true" };
    const spotifyAuthUtil = jest.fn();

    const mocks = {
      createRedisClient: jest.fn(() => redisClient),
      createLogger: jest.fn(() => logger),
      createRequestLogger: jest.fn(() => requestLogger),
      createRequireSession: jest.fn(() => requireSession),
      createErrorResponder: jest.fn(() => errorResponder),
      createPerfMetrics: jest.fn(() => perfMetrics),
      createSessionService: jest.fn(() => sessionService),
      createOauthStateService: jest.fn(() => oauthStateService),
      createSpotifyGateway: jest.fn(() => spotifyGateway),
      createSpotifyService: jest.fn(() => spotifyService),
      createCreditService: jest.fn(() => creditService),
      createSessionController: jest.fn(() => sessionController),
      createSpotifyController: jest.fn(() => spotifyController),
      createSpotifyAuthUtil: jest.fn(() => spotifyAuthUtil),
      pino: jest.fn(),
      createClient: jest.fn(),
      axios: { request: jest.fn() },
      crypto: { randomBytes: jest.fn() },
    };

    jest.doMock("axios", () => mocks.axios);
    jest.doMock("crypto", () => mocks.crypto);
    jest.doMock("pino", () => mocks.pino);
    jest.doMock("redis", () => ({ createClient: mocks.createClient }));
    jest.doMock("../../../src/data/redisClient", () => mocks.createRedisClient);
    jest.doMock("../../../src/middleware/logger", () => ({
      createLogger: mocks.createLogger,
      createRequestLogger: mocks.createRequestLogger,
    }));
    jest.doMock("../../../src/middleware/requireSession", () => mocks.createRequireSession);
    jest.doMock("../../../src/middleware/errorResponder", () => mocks.createErrorResponder);
    jest.doMock("../../../tests/perf/metricsService", () => mocks.createPerfMetrics);
    jest.doMock("../../../src/services/sessionService", () => mocks.createSessionService);
    jest.doMock("../../../src/services/oauthStateService", () => mocks.createOauthStateService);
    jest.doMock("../../../src/services/spotifyGateway", () => mocks.createSpotifyGateway);
    jest.doMock("../../../src/services/spotifyService", () => mocks.createSpotifyService);
    jest.doMock("../../../src/services/creditService", () => mocks.createCreditService);
    jest.doMock("../../../src/controllers/sessionController", () => mocks.createSessionController);
    jest.doMock("../../../src/controllers/spotifyController", () => mocks.createSpotifyController);
    jest.doMock("../../../src/utils/spotifyAuthUtil", () => mocks.createSpotifyAuthUtil);

    const buildDependencies = require("../../../src/bootstrap/dependencies");
    const deps = buildDependencies();
    process.env = oldEnv;
    return { deps, mocks, instances: { logger, redisClient, sessionService, spotifyGateway, spotifyService, perfMetrics } };
  };

  afterEach(() => {
    jest.dontMock("axios");
    jest.dontMock("crypto");
    jest.dontMock("pino");
    jest.dontMock("redis");
    jest.resetModules();
  });

  test("wires application dependencies with env-backed runtime config", () => {
    const { deps, mocks, instances } = loadWithMocks({
      PERF_METRICS: "true",
      SPOTIFY_CLIENT_ID: "client-id",
      SPOTIFY_CLIENT_SECRET: "secret",
      SPOTIFY_REDIRECT_URI: "https://api.test/callback",
      SPOTIFY_GATEWAY_MAX_CONCURRENT: "7",
      SPOTIFY_GATEWAY_MIN_INTERVAL_MS: "15",
      SPOTIFY_GATEWAY_MAX_RETRIES: "9",
      SPOTIFY_GATEWAY_RETRY_BASE_DELAY_MS: "25",
    });

    expect(mocks.createLogger).toHaveBeenCalledWith(mocks.pino);
    expect(mocks.createPerfMetrics).toHaveBeenCalledWith(true);
    expect(mocks.createRedisClient).toHaveBeenCalledWith(mocks.createClient, instances.logger);
    expect(mocks.createSpotifyGateway).toHaveBeenCalledWith(
      mocks.axios,
      expect.objectContaining({
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://api.test/callback",
        SPOTIFY_GATEWAY: expect.objectContaining({
          MAX_CONCURRENT: "7",
          MIN_INTERVAL_MS: "15",
          MAX_RETRIES: "9",
          RETRY_BASE_DELAY_MS: "25",
        }),
      }),
      instances.logger,
      instances.perfMetrics
    );
    expect(mocks.createSpotifyService).toHaveBeenCalledWith(
      instances.spotifyGateway,
      expect.any(Object),
      deps.realtimeQueueState,
      instances.sessionService.getSession,
      instances.sessionService.persistSession,
      instances.sessionService.appendPendingTrack,
      instances.sessionService.removePendingTrack,
      expect.any(Object),
      instances.perfMetrics,
      instances.logger,
      expect.any(Function)
    );
    expect(mocks.createSessionController).toHaveBeenCalledWith(
      instances.sessionService,
      expect.any(Object),
      deps.realtimeQueueState,
      expect.any(Function),
      expect.any(Function),
      instances.logger
    );
    expect(mocks.createSpotifyController).toHaveBeenCalledWith(
      instances.spotifyService,
      deps.realtimeQueueState,
      expect.any(Function),
      expect.any(Object),
      instances.sessionService,
      expect.any(Function),
      instances.logger,
      expect.any(Function)
    );
    expect(deps).toMatchObject({
      logger: instances.logger,
      spotifyGateway: instances.spotifyGateway,
      spotifyService: instances.spotifyService,
      perfMetrics: instances.perfMetrics,
    });
    expect(deps.realtimeQueueState.getSnapshot()).toBeNull();
    return expect(deps.realtimeQueueState.ensureFreshSnapshot()).resolves.toBeNull();
  });
});
