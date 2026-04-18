describe("logger middleware", () => {
  const loadLoggerModule = (nodeEnv) => {
    jest.resetModules();
    process.env.NODE_ENV = nodeEnv;
    return require("../../../src/middleware/logger");
  };

  afterEach(() => {
    delete process.env.NODE_ENV;
    jest.resetModules();
  });

  test("createLogger uses pretty debug logging outside production", () => {
    const { createLogger } = loadLoggerModule("development");
    const pino = jest.fn(() => ({ logger: true }));

    expect(createLogger(pino)).toEqual({ logger: true });
    expect(pino).toHaveBeenCalledWith({
      level: "debug",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    });
  });

  test("createLogger disables pretty transport in production", () => {
    const { createLogger } = loadLoggerModule("production");
    const pino = jest.fn(() => ({ logger: true }));

    createLogger(pino);
    expect(pino).toHaveBeenCalledWith({ level: "info", transport: undefined });
  });

  test("request logger logs request metadata and continues", () => {
    const { createRequestLogger } = loadLoggerModule("test");
    const logger = { info: jest.fn() };
    const next = jest.fn();

    createRequestLogger(logger)(
      { method: "GET", url: "/spotify/search", headers: { "user-agent": "agent" } },
      {},
      next
    );

    expect(logger.info).toHaveBeenCalledWith(
      { method: "GET", url: "/spotify/search", userAgent: "agent" },
      "Incoming request"
    );
    expect(next).toHaveBeenCalledWith();
  });
});

