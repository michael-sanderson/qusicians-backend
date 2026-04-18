const createSpotifyGateway = require("../../../src/services/spotifyGateway");
const { createLogger } = require("../helpers/testDoubles");

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("spotifyGateway", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const buildGateway = (configOverrides = {}) => {
    const axios = { request: jest.fn() };
    const logger = createLogger();
    const perfMetrics = {
      increment: jest.fn(),
      setGauge: jest.fn(),
      observeTiming: jest.fn(),
    };
    const gateway = createSpotifyGateway(
      axios,
      {
        SPOTIFY_GATEWAY: {
          MAX_CONCURRENT: 1,
          MIN_INTERVAL_MS: 0,
          MAX_RETRIES: 1,
          RETRY_BASE_DELAY_MS: 250,
          ...configOverrides,
        },
      },
      logger,
      perfMetrics
    );

    return { gateway, axios, logger, perfMetrics };
  };

  test("get and post wrap request config and resolve responses", async () => {
    const { gateway, axios, perfMetrics } = buildGateway();
    axios.request.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    axios.request.mockResolvedValueOnce({ status: 201, data: { ok: true } });

    await expect(gateway.get("/me", { headers: { A: "b" } }, { operation: "get_me" })).resolves.toEqual({
      status: 200,
      data: { ok: true },
    });
    await expect(gateway.post("/items", { uris: [] }, {}, { operation: "append" })).resolves.toEqual({
      status: 201,
      data: { ok: true },
    });

    expect(axios.request).toHaveBeenNthCalledWith(1, {
      headers: { A: "b" },
      method: "GET",
      url: "/me",
    });
    expect(axios.request).toHaveBeenNthCalledWith(2, {
      method: "POST",
      url: "/items",
      data: { uris: [] },
    });
    expect(perfMetrics.increment).toHaveBeenCalledWith(["spotify", "completed", "get_me"]);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["spotify", "status", "201", "append"]);
  });

  test("queues by priority after the active request finishes", async () => {
    const { gateway, axios } = buildGateway();
    const resolvers = [];
    axios.request.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );

    const active = gateway.request({ url: "/active" }, { operation: "active", priority: "low" });
    const low = gateway.request({ url: "/low" }, { operation: "low", priority: "low" });
    const high = gateway.request({ url: "/high" }, { operation: "high", priority: "high" });

    expect(axios.request).toHaveBeenCalledTimes(1);
    resolvers[0]({ status: 200 });
    await flushPromises();

    expect(axios.request).toHaveBeenCalledTimes(2);
    expect(axios.request.mock.calls[1][0].url).toBe("/high");
    resolvers[1]({ status: 200 });
    await flushPromises();

    expect(axios.request).toHaveBeenCalledTimes(3);
    expect(axios.request.mock.calls[2][0].url).toBe("/low");
    resolvers[2]({ status: 200 });

    await expect(Promise.all([active, high, low])).resolves.toEqual([
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ]);
  });

  test("respects minimum interval before draining queued work", async () => {
    const { gateway, axios } = buildGateway({ MIN_INTERVAL_MS: 100 });
    axios.request.mockResolvedValue({ status: 200 });

    const first = gateway.request({ url: "/first" }, { operation: "first" });
    const second = gateway.request({ url: "/second" }, { operation: "second" });

    await first;
    expect(axios.request).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(99);
    expect(axios.request).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await second;
    expect(axios.request).toHaveBeenCalledTimes(2);
  });

  test("retries 429 responses using retry-after header", async () => {
    const { gateway, axios, logger, perfMetrics } = buildGateway({ MAX_RETRIES: 1 });
    const rateLimitError = Object.assign(new Error("rate limited"), {
      response: { status: 429, headers: { "retry-after": "2" } },
    });
    axios.request.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({ status: 200 });

    const promise = gateway.request({ url: "/search" }, { operation: "search_tracks" });
    await flushPromises();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ retryDelayMs: 2000 }), "Spotify request rate limited, retrying");

    await jest.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual({ status: 200 });
    expect(axios.request).toHaveBeenCalledTimes(2);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["spotify", "retries", "search_tracks"]);
  });

  test("rejects failed requests after retry budget is exhausted", async () => {
    const { gateway, axios, perfMetrics } = buildGateway({ MAX_RETRIES: 0 });
    const error = Object.assign(new Error("server down"), {
      response: { status: 500, headers: {} },
    });
    axios.request.mockRejectedValueOnce(error);

    await expect(gateway.request({}, {})).rejects.toBe(error);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["spotify", "failed", "spotify_request"]);
    expect(perfMetrics.increment).toHaveBeenCalledWith(["spotify", "status", "500", "spotify_request"]);
  });
  test("uses FIFO ordering for same priority, unknown urls, retry fallback delay, and concurrent drain", async () => {
    const { gateway, axios, logger } = buildGateway({ MAX_CONCURRENT: 2, MAX_RETRIES: 1, RETRY_BASE_DELAY_MS: 300 });
    const rateLimitedWithoutHeader = Object.assign(new Error("rate limited"), {
      response: { status: 429, headers: { "retry-after": "nope" } },
    });
    axios.request
      .mockResolvedValueOnce({ status: 200, data: "first" })
      .mockResolvedValueOnce({ status: 200, data: "second" })
      .mockRejectedValueOnce(rateLimitedWithoutHeader)
      .mockResolvedValueOnce({ status: 200, data: "retried" });

    const first = gateway.request({ method: "GET" }, { operation: "first", priority: "normal" });
    const second = gateway.request({ url: "/second" }, { operation: "second", priority: "normal" });
    const third = gateway.request({ url: "/third" }, { operation: "third", priority: "normal" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 200, data: "first" },
      { status: 200, data: "second" },
    ]);
    expect(axios.request.mock.calls[0][0]).toEqual({ method: "GET" });
    expect(axios.request.mock.calls[1][0].url).toBe("/second");
    await flushPromises();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ retryDelayMs: 300 }), "Spotify request rate limited, retrying");

    await jest.advanceTimersByTimeAsync(300);
    await expect(third).resolves.toEqual({ status: 200, data: "retried" });
    expect(axios.request).toHaveBeenCalledTimes(4);
  });
  test("orders equal-priority delayed work FIFO and drains concurrent capacity", async () => {
    const { gateway, axios } = buildGateway({ MAX_CONCURRENT: 2, MIN_INTERVAL_MS: 100 });
    axios.request.mockResolvedValue({ status: 200 });

    await gateway.request({ url: "/warmup" }, { operation: "warmup" });
    const second = gateway.request({ url: "/second" }, { operation: "second", priority: "normal" });
    const third = gateway.request({ url: "/third" }, { operation: "third", priority: "normal" });

    expect(axios.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);
    await expect(Promise.all([second, third])).resolves.toEqual([{ status: 200 }, { status: 200 }]);

    expect(axios.request.mock.calls[1][0].url).toBe("/second");
    expect(axios.request.mock.calls[2][0].url).toBe("/third");
  });
});


