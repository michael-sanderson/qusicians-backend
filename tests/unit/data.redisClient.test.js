const EventEmitter = require("events");
const createRedisClient = require("../../src/data/redisClient");
const { createLogger } = require("./helpers/testDoubles");

describe("redisClient", () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    delete process.env.REDIS_URL;
  });

  const buildFakeClient = (connectImpl = jest.fn(async () => {})) => {
    const client = new EventEmitter();
    client.connect = connectImpl;
    return client;
  };

  test("creates and connects Redis client with configured URL", async () => {
    process.env.REDIS_URL = "redis://example";
    const logger = createLogger();
    const client = buildFakeClient();
    const createClient = jest.fn(() => client);

    expect(createRedisClient(createClient, logger)).toBe(client);
    await client.connect.mock.results[0].value;

    expect(createClient).toHaveBeenCalledWith({ url: "redis://example" });
    expect(logger.info).toHaveBeenCalledWith("Redis connection established successfully");
  });

  test("logs Redis lifecycle events", () => {
    const logger = createLogger();
    const client = buildFakeClient();
    createRedisClient(() => client, logger);
    const err = new Error("redis boom");

    client.emit("connect");
    client.emit("ready");
    client.emit("error", err);
    client.emit("end");

    expect(logger.info).toHaveBeenCalledWith("Redis connecting...");
    expect(logger.info).toHaveBeenCalledWith("Redis ready");
    expect(logger.error).toHaveBeenCalledWith({ err }, "Redis error");
    expect(logger.warn).toHaveBeenCalledWith("Redis connection closed");
  });

  test("fails fast if initial connection fails", async () => {
    const logger = createLogger();
    const err = new Error("cannot connect");
    const client = buildFakeClient(jest.fn(async () => { throw err; }));
    process.exit = jest.fn();

    createRedisClient(() => client, logger);
    await client.connect.mock.results[0].value.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith({ err }, "Redis connection failed - shutting down");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

