// realtime/queueRealtimeGateway.js
//
// Server-authoritative queue mirror broadcaster.
// One polling loop per active session room, distributed to all connected clients.

const { Server } = require("socket.io");

module.exports = (
  httpServer,
  {
    parseSessionCookie,
    sessionService,
    spotifyService,
    logger,
    realtimeQueueState,
    perfMetrics,
  }
) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://127.0.0.1:5173",
      credentials: true,
    },
  });

  const POLL_INTERVAL_MS = Number(process.env.QUEUE_POLL_INTERVAL_MS || 15000);
  const ROOM_PREFIX = "session:";
  const SESSION_COOKIE_NAME = "partySession";

  const pollers = new Map();
  const snapshots = new Map();
  const refreshLocks = new Map();

  const roomName = (sessionId) => `${ROOM_PREFIX}${sessionId}`;

  const parseSessionFromCookieHeader = (cookieHeader) => {
    if (!cookieHeader) return null;

    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)
    );
    if (!match?.[1]) return null;

    const decoded = decodeURIComponent(match[1]);
    const parsed = parseSessionCookie(decoded);
    return parsed.ok ? parsed : null;
  };

  const emitSnapshot = (sessionId, payload) => {
    perfMetrics?.increment(["realtime", "snapshot", "emitted"]);
    io.to(roomName(sessionId)).emit("queue:snapshot", payload);
  };

  const updateSnapshot = (sessionId, payload) => {
    const serialized = JSON.stringify(payload);
    const previous = snapshots.get(sessionId);
    if (previous?.serialized === serialized) {
      return false;
    }

    snapshots.set(sessionId, { serialized, payload });
    emitSnapshot(sessionId, payload);
    return true;
  };

  const fetchQueueForSession = async (sessionId) => {
    const session = await sessionService.getSession(sessionId);
    const payload = await spotifyService.getQueue(session);
    return payload;
  };

  const refreshSnapshotOnce = async (sessionId) => {
    const existingLock = refreshLocks.get(sessionId);
    if (existingLock) return existingLock;

    const lock = (async () => {
      if (typeof spotifyService.flushPendingTracks === "function") {
        await spotifyService.flushPendingTracks(sessionId);
      }
      const payload = await fetchQueueForSession(sessionId);
      updateSnapshot(sessionId, payload);
      return payload;
    })().finally(() => {
      refreshLocks.delete(sessionId);
    });

    refreshLocks.set(sessionId, lock);
    return lock;
  };

  const runPollTick = async (sessionId) => {
    const state = pollers.get(sessionId);
    if (!state || state.running) return;

    state.running = true;
    try {
      await refreshSnapshotOnce(sessionId);
    } catch (err) {
      if (err?.code === "SESSION_NOT_FOUND") {
        notifySessionEnded(sessionId, "session_not_found");
        return;
      }

      logger.warn({ err, sessionId }, "Realtime queue poll tick failed");
    } finally {
      const latest = pollers.get(sessionId);
      if (latest) {
        latest.running = false;
      }
    }
  };

  const startPoller = (sessionId) => {
    if (pollers.has(sessionId)) return;

    const intervalId = setInterval(() => {
      runPollTick(sessionId);
    }, POLL_INTERVAL_MS);

    pollers.set(sessionId, {
      intervalId,
      running: false,
    });

    runPollTick(sessionId);
  };

  const stopPoller = (sessionId) => {
    const state = pollers.get(sessionId);
    if (state?.intervalId) {
      clearInterval(state.intervalId);
    }
    pollers.delete(sessionId);
    snapshots.delete(sessionId);
  };

  const stopIfRoomEmpty = (sessionId) => {
    const room = io.sockets.adapter.rooms.get(roomName(sessionId));
    if (!room || room.size === 0) {
      stopPoller(sessionId);
    }
  };

  const notifySessionEnded = (sessionId, reason = "session_ended") => {
    if (!sessionId) return;

    io.to(roomName(sessionId)).emit("session:ended", { sessionId, reason });
    stopPoller(sessionId);
  };

  io.on("connection", async (socket) => {
    try {
      const parsed = parseSessionFromCookieHeader(socket.handshake.headers.cookie);

      if (!parsed?.sessionId) {
        socket.emit("session:ended", { reason: "missing_session_cookie" });
        socket.disconnect(true);
        return;
      }

      await sessionService.getSession(parsed.sessionId);

      const sessionId = parsed.sessionId;
      socket.data.sessionId = sessionId;
      socket.join(roomName(sessionId));
      perfMetrics?.increment(["realtime", "socket", "connected"]);
      perfMetrics?.setGauge(["realtime", "socket", "active"], io.engine.clientsCount);

      const cached = snapshots.get(sessionId);
      if (cached?.payload) {
        socket.emit("queue:snapshot", cached.payload);
      } else {
        await refreshSnapshotOnce(sessionId);
      }

      startPoller(sessionId);

      socket.on("disconnect", () => {
        perfMetrics?.increment(["realtime", "socket", "disconnected"]);
        perfMetrics?.setGauge(["realtime", "socket", "active"], io.engine.clientsCount);
        stopIfRoomEmpty(sessionId);
      });
    } catch (err) {
      if (err?.code === "SESSION_NOT_FOUND") {
        socket.emit("session:ended", { reason: "session_not_found" });
      } else {
        logger.warn({ err }, "Socket connection setup failed");
      }
      socket.disconnect(true);
    }
  });

  realtimeQueueState.getSnapshot = (sessionId) => snapshots.get(sessionId)?.payload || null;
  realtimeQueueState.ensureFreshSnapshot = async (sessionId) => {
    if (!sessionId) return null;

    const cached = snapshots.get(sessionId)?.payload;
    if (cached) return cached;

    try {
      return await refreshSnapshotOnce(sessionId);
    } catch (err) {
      if (err?.code === "SESSION_NOT_FOUND") {
        return null;
      }
      logger.warn({ err, sessionId }, "Failed to produce fresh realtime snapshot");
      return null;
    }
  };
  realtimeQueueState.refreshNow = async (sessionId) => {
    if (!sessionId) return null;
    try {
      return await refreshSnapshotOnce(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId }, "Forced realtime refresh failed");
      return null;
    }
  };
  realtimeQueueState.notifySessionEnded = notifySessionEnded;

  return {
    io,
    shutdown: () => {
      Array.from(pollers.keys()).forEach((sessionId) => stopPoller(sessionId));
      io.close();
    },
  };
};
