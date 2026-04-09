module.exports = (perfMetrics) =>
  function httpMetricsMiddleware(req, res, next) {
    if (!perfMetrics?.enabled) {
      next();
      return;
    }

    const routeKey = req.path || req.originalUrl || "unknown";
    if (routeKey.startsWith("/__perf")) {
      next();
      return;
    }

    const startedAt = Date.now();

    perfMetrics.increment(["http", "requests", req.method, routeKey]);

    res.on("finish", () => {
      perfMetrics.increment([
        "http",
        "responses",
        req.method,
        routeKey,
        String(res.statusCode),
      ]);
      perfMetrics.observeTiming(
        ["http", "latency", req.method, routeKey],
        Date.now() - startedAt
      );
    });

    next();
  };
