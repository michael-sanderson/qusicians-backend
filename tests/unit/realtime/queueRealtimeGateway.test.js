let latestServer;

jest.mock("socket.io", () => {
  const EventEmitter = require("events");
  class FakeServer extends EventEmitter {
    constructor(httpServer, options) {
      super();
      this.httpServer = httpServer;
      this.options = options;
      this.engine = { clientsCount: 0 };
      this.sockets = { adapter: { rooms: new Map() } };
      this.close = jest.fn();
      this.to = jest.fn((room) => ({ emit: jest.fn((event, payload) => this.emit(`room:${room}:${event}`, payload)) }));
      latestServer = this;
    }
  }

  return { Server: FakeServer };
});

const EventEmitter = require("events");
const createRealtimeGateway = require("../../../src/realtime/queueRealtimeGateway");
const { createLogger } = require("../helpers/testDoubles");

class FakeSocket extends EventEmitter {
  constructor(cookie) {
    super();
    this.handshake = { headers: { cookie } };
    this.data = {};
    this.emit = jest.fn(super.emit.bind(this));
    this.disconnect = jest.fn();
    this.join = jest.fn((room) => {
      this.room = room;
      const rooms = latestServer.sockets.adapter.rooms;
      const members = rooms.get(room) || new Set();
      members.add(this);
      rooms.set(room, members);
    });
  }

  triggerDisconnect() {
    if (this.room) {
      const members = latestServer.sockets.adapter.rooms.get(this.room);
      members?.delete(this);
    }
    super.emit("disconnect");
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("queueRealtimeGateway", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.CORS_ORIGIN = "https://www.qusicians.test";
    process.env.QUEUE_POLL_INTERVAL_MS = "1000";
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.CORS_ORIGIN;
    delete process.env.QUEUE_POLL_INTERVAL_MS;
    latestServer = null;
  });

  const buildGateway = (overrides = {}) => {
    const session = { sessionId: "s1", accessToken: "token" };
    const snapshot = { queue: [{ uri: "spotify:track:1" }] };
    const deps = {
      parseSessionCookie: jest.fn(() => ({ ok: true, sessionId: "s1" })),
      sessionService: { getSession: jest.fn(async () => session) },
      spotifyService: {
        getQueue: jest.fn(async () => snapshot),
        flushPendingTracks: jest.fn(async () => {}),
      },
      logger: createLogger(),
      realtimeQueueState: {},
      perfMetrics: { increment: jest.fn(), setGauge: jest.fn() },
      ...overrides,
    };
    const gateway = createRealtimeGateway({}, deps);
    return { gateway, deps, io: latestServer, snapshot };
  };

  test("constructs socket server with CORS settings", () => {
    const { io, gateway } = buildGateway();

    expect(io.options).toEqual({
      cors: { origin: "https://www.qusicians.test", credentials: true },
    });
    gateway.shutdown();
    expect(io.close).toHaveBeenCalled();
  });

  test("disconnects sockets without a valid session cookie", async () => {
    const { io, deps } = buildGateway({
      parseSessionCookie: jest.fn(() => ({ ok: false })),
    });
    const socket = new FakeSocket("");

    io.emit("connection", socket);
    await flushPromises();
    await flushPromises();

    expect(deps.parseSessionCookie).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("session:ended", { reason: "missing_session_cookie" });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test("joins valid sockets, refreshes queue, caches snapshot, and starts poller", async () => {
    const { io, deps, snapshot } = buildGateway();
    const cookie = `partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`;
    const socket = new FakeSocket(cookie);

    io.emit("connection", socket);
    await flushPromises();
    await flushPromises();

    expect(deps.parseSessionCookie).toHaveBeenCalledWith(JSON.stringify({ sessionId: "s1" }));
    expect(socket.join).toHaveBeenCalledWith("session:s1");
    expect(deps.spotifyService.flushPendingTracks).toHaveBeenCalledWith("s1");
    expect(deps.spotifyService.getQueue).toHaveBeenCalledWith({ sessionId: "s1", accessToken: "token" });
    expect(deps.realtimeQueueState.getSnapshot("s1")).toEqual(snapshot);
    expect(deps.perfMetrics.increment).toHaveBeenCalledWith(["realtime", "socket", "connected"]);

    const secondSocket = new FakeSocket(cookie);
    io.emit("connection", secondSocket);
    await flushPromises();
    await flushPromises();
    expect(secondSocket.emit).toHaveBeenCalledWith("queue:snapshot", snapshot);
  });

  test("ensures fresh snapshot with lock, cached return, and missing session fallback", async () => {
    const { deps } = buildGateway();

    await expect(Promise.all([
      deps.realtimeQueueState.ensureFreshSnapshot("s1"),
      deps.realtimeQueueState.ensureFreshSnapshot("s1"),
    ])).resolves.toEqual([
      { queue: [{ uri: "spotify:track:1" }] },
      { queue: [{ uri: "spotify:track:1" }] },
    ]);
    expect(deps.spotifyService.getQueue).toHaveBeenCalledTimes(1);
    await expect(deps.realtimeQueueState.ensureFreshSnapshot()).resolves.toBeNull();
  });

  test("returns null and logs when fresh snapshot fails for non-session errors", async () => {
    const err = new Error("spotify down");
    const { deps } = buildGateway({
      spotifyService: {
        flushPendingTracks: jest.fn(async () => {}),
        getQueue: jest.fn(async () => { throw err; }),
      },
    });

    await expect(deps.realtimeQueueState.ensureFreshSnapshot("s1")).resolves.toBeNull();
    expect(deps.logger.warn).toHaveBeenCalledWith({ err, sessionId: "s1" }, "Failed to produce fresh realtime snapshot");
  });

  test("refreshNow returns null on failure and notifySessionEnded emits", async () => {
    const err = new Error("boom");
    const { deps, io } = buildGateway({
      spotifyService: {
        flushPendingTracks: jest.fn(async () => { throw err; }),
        getQueue: jest.fn(),
      },
    });

    await expect(deps.realtimeQueueState.refreshNow()).resolves.toBeNull();
    await expect(deps.realtimeQueueState.refreshNow("s1")).resolves.toBeNull();
    expect(deps.logger.warn).toHaveBeenCalledWith({ err, sessionId: "s1" }, "Forced realtime refresh failed");

    deps.realtimeQueueState.notifySessionEnded("s1", "host_ended_session");
    expect(io.to).toHaveBeenCalledWith("session:s1");
  });

  test("connection setup sends ended event if session disappears", async () => {
    const sessionNotFound = Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" });
    const { io, deps } = buildGateway({
      sessionService: { getSession: jest.fn(async () => { throw sessionNotFound; }) },
    });
    const socket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);

    io.emit("connection", socket);
    await flushPromises();
    await flushPromises();

    expect(socket.emit).toHaveBeenCalledWith("session:ended", { reason: "session_not_found" });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(deps.logger.warn).not.toHaveBeenCalledWith(expect.anything(), "Socket connection setup failed");
  });

  test("disconnect updates metrics and stops empty room poller", async () => {
    const { io, deps } = buildGateway();
    const socket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);

    io.emit("connection", socket);
    await flushPromises();
    await flushPromises();
    for (let i = 0; i < 5 && socket.listenerCount("disconnect") === 0; i += 1) {
      await flushPromises();
    }
    socket.triggerDisconnect();

    expect(deps.perfMetrics.increment).toHaveBeenCalledWith(["realtime", "socket", "disconnected"]);
    expect(deps.realtimeQueueState.getSnapshot("s1")).toBeNull();
  });

  test("poller handles missing sessions and transient poll failures", async () => {
    const sessionNotFound = Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" });
    const transient = new Error("spotify glitch");
    const { io, deps } = buildGateway({
      spotifyService: {
        flushPendingTracks: jest.fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined),
        getQueue: jest.fn()
          .mockResolvedValueOnce({ queue: [] })
          .mockRejectedValueOnce(transient)
          .mockRejectedValueOnce(sessionNotFound),
      },
    });
    const socket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);

    io.emit("connection", socket);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(deps.logger.warn).toHaveBeenCalledWith({ err: transient, sessionId: "s1" }, "Realtime queue poll tick failed");

    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(io.to).toHaveBeenCalledWith("session:s1");
    expect(deps.realtimeQueueState.getSnapshot("s1")).toBeNull();
  });

  test("logs unexpected socket setup failures", async () => {
    const err = new Error("bad cookie parse");
    const { io, deps } = buildGateway({
      parseSessionCookie: jest.fn(() => { throw err; }),
    });
    const socket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);

    io.emit("connection", socket);
    await flushPromises();

    expect(deps.logger.warn).toHaveBeenCalledWith({ err }, "Socket connection setup failed");
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test("ensureFreshSnapshot returns null when session disappears", async () => {
    const err = Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" });
    const { deps } = buildGateway({
      sessionService: { getSession: jest.fn(async () => { throw err; }) },
    });

    await expect(deps.realtimeQueueState.ensureFreshSnapshot("s1")).resolves.toBeNull();
  });


  test("covers unmatched cookies, cached snapshots, running poll guards, default ended notifications, and shutdown", async () => {
    let resolveQueue;
    const { io, deps, gateway } = buildGateway({
      spotifyService: {
        flushPendingTracks: jest.fn(async () => {}),
        getQueue: jest.fn(() => new Promise((resolve) => { resolveQueue = resolve; })),
      },
    });
    const socket = new FakeSocket("otherCookie=value");
    io.emit("connection", socket);
    await flushPromises();
    expect(socket.emit).toHaveBeenCalledWith("session:ended", { reason: "missing_session_cookie" });

    const goodSocket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);
    io.emit("connection", goodSocket);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(1000);
    expect(deps.spotifyService.getQueue).toHaveBeenCalledTimes(1);
    resolveQueue({ queue: [] });
    await flushPromises();
    await expect(deps.realtimeQueueState.ensureFreshSnapshot("s1")).resolves.toEqual({ queue: [] });

    deps.realtimeQueueState.notifySessionEnded(null);
    deps.realtimeQueueState.notifySessionEnded("s1");
    expect(io.to).toHaveBeenCalledWith("session:s1");
    gateway.shutdown();
    expect(io.close).toHaveBeenCalled();
  });
  test("shutdown stops active pollers and poll ticks no-op while already running", async () => {
    let resolveSecondPoll;
    const { io, deps, gateway } = buildGateway({
      spotifyService: {
        flushPendingTracks: jest.fn(async () => {}),
        getQueue: jest.fn()
          .mockResolvedValueOnce({ queue: [] })
          .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondPoll = resolve; })),
      },
    });
    const socket = new FakeSocket(`partySession=${encodeURIComponent(JSON.stringify({ sessionId: "s1" }))}`);

    io.emit("connection", socket);
    for (let i = 0; i < 5 && deps.spotifyService.getQueue.mock.calls.length < 2; i += 1) {
      await flushPromises();
    }
    expect(deps.spotifyService.getQueue).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1000);
    expect(deps.spotifyService.getQueue).toHaveBeenCalledTimes(2);

    gateway.shutdown();
    expect(io.close).toHaveBeenCalled();
    resolveSecondPoll({ queue: [] });
    await flushPromises();
  });
});


