// services/spotifyGateway.js
//
// Centralized Spotify upstream gateway.
// Owns request scheduling, retry-on-429 behavior, and request classification.

module.exports = (axios, config, logger, perfMetrics) => {
  const priorityRank = {
    high: 0,
    normal: 1,
    low: 2,
  };

  const pending = [];
  const runtime = {
    activeCount: 0,
    lastStartedAt: 0,
    drainTimer: null,
    sequence: 0,
  };

  const maxConcurrent = Math.max(1, Number(config?.SPOTIFY_GATEWAY?.MAX_CONCURRENT || 1));
  const minIntervalMs = Math.max(0, Number(config?.SPOTIFY_GATEWAY?.MIN_INTERVAL_MS || 0));
  const maxRetries = Math.max(0, Number(config?.SPOTIFY_GATEWAY?.MAX_RETRIES || 1));
  const retryBaseDelayMs = Math.max(
    250,
    Number(config?.SPOTIFY_GATEWAY?.RETRY_BASE_DELAY_MS || 1000)
  );

  const getPriorityRank = (priority) => priorityRank[priority] ?? priorityRank.normal;

  const sortPending = () => {
    pending.sort((left, right) => {
      const priorityDiff =
        getPriorityRank(left.meta?.priority) - getPriorityRank(right.meta?.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return left.sequence - right.sequence;
    });
  };

  const parseRetryAfterMs = (headers = {}) => {
    const retryAfterHeader = headers["retry-after"] ?? headers["Retry-After"];
    const parsedSeconds = Number(retryAfterHeader);

    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return parsedSeconds * 1000;
    }

    return null;
  };

  const getRequestUrl = (requestConfig = {}) => {
    if (typeof requestConfig.url === "string") {
      return requestConfig.url;
    }

    return "unknown_url";
  };

  const getMetaLog = (task) => ({
    operation: task.meta?.operation || "spotify_request",
    priority: task.meta?.priority || "normal",
    method: task.requestConfig?.method || "GET",
    url: getRequestUrl(task.requestConfig),
    queueDepth: pending.length,
    activeCount: runtime.activeCount,
  });

  const wait = (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });

  const buildRetryDelayMs = (attempt, err) =>
    parseRetryAfterMs(err?.response?.headers) || retryBaseDelayMs * attempt;

  const runRequest = async (requestConfig, meta, attempt = 1) => {
    try {
      return await axios.request(requestConfig);
    } catch (err) {
      const status = err?.response?.status;
      const shouldRetry = status === 429 && attempt <= maxRetries;

      if (!shouldRetry) {
        throw err;
      }

      const retryDelayMs = buildRetryDelayMs(attempt, err);

      logger.warn(
        {
          operation: meta?.operation || "spotify_request",
          priority: meta?.priority || "normal",
          attempt,
          retryDelayMs,
        },
        "Spotify request rate limited, retrying"
      );
      perfMetrics?.increment(["spotify", "retries", meta?.operation || "spotify_request"]);
      perfMetrics?.increment(["spotify", "status", "429", meta?.operation || "spotify_request"]);

      await wait(retryDelayMs);
      return runRequest(requestConfig, meta, attempt + 1);
    }
  };

  const scheduleDrain = () => {
    if (runtime.drainTimer) return;

    const elapsed = Date.now() - runtime.lastStartedAt;
    const delayMs = Math.max(0, minIntervalMs - elapsed);

    runtime.drainTimer = setTimeout(() => {
      runtime.drainTimer = null;
      drainPending();
    }, delayMs);
  };

  const runTask = async (task) => {
    const startedAt = Date.now();

    runtime.activeCount += 1;
    runtime.lastStartedAt = Date.now();

    logger.debug(
      {
        ...getMetaLog(task),
        queueDepth: pending.length,
        activeCount: runtime.activeCount,
      },
      "Spotify request started"
    );
    perfMetrics?.increment(["spotify", "started", task.meta?.operation || "spotify_request"]);
    perfMetrics?.setGauge(["spotify", "queueDepth"], pending.length);
    perfMetrics?.setGauge(["spotify", "activeCount"], runtime.activeCount);

    try {
      const response = await runRequest(task.requestConfig, task.meta);
      logger.info(
        {
          ...getMetaLog(task),
          status: response?.status,
          durationMs: Date.now() - startedAt,
        },
        "Spotify request completed"
      );
      perfMetrics?.increment(["spotify", "completed", task.meta?.operation || "spotify_request"]);
      perfMetrics?.increment([
        "spotify",
        "status",
        String(response?.status || 0),
        task.meta?.operation || "spotify_request",
      ]);
      perfMetrics?.observeTiming(
        ["spotify", "latency", task.meta?.operation || "spotify_request"],
        Date.now() - startedAt
      );
      task.resolve(response);
    } catch (err) {
      logger.warn(
        {
          ...getMetaLog(task),
          status: err?.response?.status,
          durationMs: Date.now() - startedAt,
        },
        "Spotify request failed"
      );
      perfMetrics?.increment(["spotify", "failed", task.meta?.operation || "spotify_request"]);
      perfMetrics?.increment([
        "spotify",
        "status",
        String(err?.response?.status || 0),
        task.meta?.operation || "spotify_request",
      ]);
      perfMetrics?.observeTiming(
        ["spotify", "latency", task.meta?.operation || "spotify_request"],
        Date.now() - startedAt
      );
      task.reject(err);
    } finally {
      runtime.activeCount -= 1;
      perfMetrics?.setGauge(["spotify", "queueDepth"], pending.length);
      perfMetrics?.setGauge(["spotify", "activeCount"], runtime.activeCount);
      drainPending();
    }
  };

  const drainPending = () => {
    if (runtime.activeCount >= maxConcurrent || pending.length === 0) {
      return;
    }

    const elapsed = Date.now() - runtime.lastStartedAt;
    if (elapsed < minIntervalMs) {
      scheduleDrain();
      return;
    }

    const task = pending.shift();
    runTask(task);

    if (runtime.activeCount < maxConcurrent && pending.length > 0) {
      drainPending();
    }
  };

  const request = (requestConfig, meta = {}) =>
    new Promise((resolve, reject) => {
      const task = {
        requestConfig,
        meta,
        resolve,
        reject,
        sequence: runtime.sequence++,
      };

      pending.push(task);

      sortPending();

      logger.debug(
        {
          ...getMetaLog(task),
          queueDepth: pending.length,
          activeCount: runtime.activeCount,
        },
        "Spotify request queued"
      );
      perfMetrics?.increment(["spotify", "queued", task.meta?.operation || "spotify_request"]);
      perfMetrics?.setGauge(["spotify", "queueDepth"], pending.length);

      drainPending();
    });

  const get = (url, requestConfig = {}, meta = {}) =>
    request(
      {
        ...requestConfig,
        method: "GET",
        url,
      },
      meta
    );

  const post = (url, data, requestConfig = {}, meta = {}) =>
    request(
      {
        ...requestConfig,
        method: "POST",
        url,
        data,
      },
      meta
    );

  return {
    request,
    get,
    post,
  };
};
