const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { scenarioCatalog, suiteOrder } = require("./scenarios");

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:3000";
const cliSessionId = process.argv[3] || "";
const sessionId = process.env.PERF_SESSION_ID || cliSessionId;
const outputDir = path.resolve(__dirname, "output");

const perfClient = axios.create({
  baseURL: baseUrl,
  validateStatus: () => true,
});

const delay = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const requireSessionId = () => {
  if (!sessionId) {
    throw new Error("Session id is required. Run: npm run perf:... -- YOUR_SESSION_ID");
  }

  return sessionId;
};

const requireScenarioName = () => {
  const scenarioName = process.argv[2];
  const supported = "full";

  if (scenarioName !== "full") {
    throw new Error(`Missing or invalid scenario name. Use one of: ${supported}`);
  }

  return scenarioName;
};

const buildGuestName = (index) => `perf-${Date.now().toString(36)}-${index}`;

const extractCookieHeader = (headers = {}) => {
  const setCookies = headers["set-cookie"];

  if (!Array.isArray(setCookies) || setCookies.length === 0) {
    return "";
  }

  return setCookies.map((entry) => entry.split(";")[0]).join("; ");
};

const ensureOutputDir = () => {
  fs.mkdirSync(outputDir, { recursive: true });
};

const writeReport = (name, report) => {
  ensureOutputDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `${timestamp}-${name}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  return outputPath;
};

const sumCounterGroup = (counters, prefix) =>
  Object.entries(counters)
    .filter(([key]) => key.startsWith(prefix))
    .reduce((total, [, value]) => total + value, 0);

const summarizeResults = (label, results) => {
  const statuses = results.reduce((acc, result) => {
    const statusKey = String(result?.status || 0);
    acc[statusKey] = (acc[statusKey] || 0) + 1;
    return acc;
  }, {});

  return {
    label,
    total: results.length,
    ok: results.filter((result) => result?.ok).length,
    failed: results.filter((result) => !result?.ok).length,
    statuses,
    sampleFailures: results
      .filter((result) => !result?.ok)
      .slice(0, 5)
      .map((result) => ({
        status: result?.status || 0,
        body: result?.body || null,
      })),
  };
};

const buildCommonMetricsSummary = (metrics) => ({
  backendHttpHits: sumCounterGroup(metrics.counters, "http.requests."),
  spotifyHits: sumCounterGroup(metrics.counters, "spotify.started."),
  spotifyFailures: sumCounterGroup(metrics.counters, "spotify.failed."),
  searchCacheHits: sumCounterGroup(metrics.counters, "search.cache.hit"),
  searchCacheMisses: sumCounterGroup(metrics.counters, "search.cache.miss"),
  searchDedupeHits: sumCounterGroup(metrics.counters, "search.dedupe.hit"),
  flushCompleted: sumCounterGroup(metrics.counters, "flush.completed"),
  flushFailures: sumCounterGroup(metrics.counters, "flush.failed"),
  realtimeSnapshots: sumCounterGroup(metrics.counters, "realtime.snapshot.emitted"),
});

const buildSpotifyOperationSummary = (metrics) => {
  const operations = new Set();

  Object.keys(metrics.counters || {}).forEach((key) => {
    const startedMatch = key.match(/^spotify\.started\.(.+)$/);
    const completedMatch = key.match(/^spotify\.completed\.(.+)$/);
    const failedMatch = key.match(/^spotify\.failed\.(.+)$/);
    const statusMatch = key.match(/^spotify\.status\.([^.]+)\.(.+)$/);

    if (startedMatch?.[1]) operations.add(startedMatch[1]);
    if (completedMatch?.[1]) operations.add(completedMatch[1]);
    if (failedMatch?.[1]) operations.add(failedMatch[1]);
    if (statusMatch?.[2]) operations.add(statusMatch[2]);
  });

  return Array.from(operations)
    .sort()
    .map((operation) => {
      const statuses = Object.entries(metrics.counters || {})
        .filter(([key]) => key.startsWith(`spotify.status.`) && key.endsWith(`.${operation}`))
        .reduce((acc, [key, value]) => {
          const parts = key.split(".");
          const statusCode = parts[2];
          acc[statusCode] = value;
          return acc;
        }, {});

      return {
        operation,
        queued: metrics.counters[`spotify.queued.${operation}`] || 0,
        started: metrics.counters[`spotify.started.${operation}`] || 0,
        completed: metrics.counters[`spotify.completed.${operation}`] || 0,
        failed: metrics.counters[`spotify.failed.${operation}`] || 0,
        retries: metrics.counters[`spotify.retries.${operation}`] || 0,
        statuses,
      };
    });
};

const buildScenarioFocusSummary = (scenarioName, metrics, joinSummary, actionSummary, meta = {}) => {
  const common = buildCommonMetricsSummary(metrics);

  if (scenarioName === "join-only") {
    return {
      joinRequests: joinSummary.total,
      joinFailures: joinSummary.failed,
      backendJoinHits: sumCounterGroup(metrics.counters, "http.requests.POST./session/join"),
      spotifyHits: common.spotifyHits,
    };
  }

  if (scenarioName === "search-dedupe") {
    return {
      query: meta.query || null,
      joinFailures: joinSummary.failed,
      searchFailures: actionSummary.failed,
      backendSearchHits: sumCounterGroup(metrics.counters, "http.requests.GET./spotify/search"),
      spotifySearchHits: sumCounterGroup(metrics.counters, "spotify.started.search_tracks"),
      searchCacheMisses: common.searchCacheMisses,
      searchDedupeHits: common.searchDedupeHits,
    };
  }

  if (scenarioName === "search-cache") {
    return {
      query: meta.query || null,
      waveCount: meta.waveCount || 0,
      waveDelayMs: meta.waveDelayMs || 0,
      warmupRequests: meta.warmupRequests || 0,
      joinFailures: joinSummary.failed,
      searchFailures: actionSummary.failed,
      backendSearchHits: sumCounterGroup(metrics.counters, "http.requests.GET./spotify/search"),
      spotifySearchHits: sumCounterGroup(metrics.counters, "spotify.started.search_tracks"),
      searchCacheHits: common.searchCacheHits,
      searchCacheMisses: common.searchCacheMisses,
      searchDedupeHits: common.searchDedupeHits,
    };
  }

  if (scenarioName === "add-burst") {
    return {
      query: meta.query || null,
      prefetchedTrack: Boolean(meta.prefetchedTrack),
      trackUri: meta.trackUri || null,
      joinFailures: joinSummary.failed,
      actionFailures: actionSummary.failed,
      backendAddHits: sumCounterGroup(metrics.counters, "http.requests.POST./spotify/add"),
      spotifyPlaylistAppends: sumCounterGroup(
        metrics.counters,
        "spotify.started.append_tracks_to_playlist"
      ),
      spotifySearchHits: sumCounterGroup(metrics.counters, "spotify.started.search_tracks"),
      flushCompleted: common.flushCompleted,
      flushFailures: common.flushFailures,
    };
  }

  return common;
};

const printSpotifyOperations = (report) => {
  if (!Array.isArray(report.spotifyOperations) || report.spotifyOperations.length === 0) {
    return;
  }

  console.log("Spotify operations:");
  report.spotifyOperations.forEach((entry) => {
    console.log(
      `  ${entry.operation}: started=${entry.started}, completed=${entry.completed}, failed=${entry.failed}, retries=${entry.retries}, statuses=${JSON.stringify(entry.statuses)}`
    );
  });
};

const printScenarioSummary = (scenarioName, report) => {
  const summary = report.focusSummary;

  console.log(`Scenario: ${scenarioName}`);
  console.log(`Report: ${report.outputPath}`);

  if (scenarioName === "join-only") {
    console.log(`Join requests: ${summary.joinRequests}`);
    console.log(`Join failures: ${summary.joinFailures}`);
    console.log(`Backend join hits: ${summary.backendJoinHits}`);
    console.log(`Spotify hits: ${summary.spotifyHits}`);
    printSpotifyOperations(report);
    return;
  }

  if (scenarioName === "search-dedupe") {
    console.log(`Search query: ${summary.query}`);
    console.log(`Backend search hits: ${summary.backendSearchHits}`);
    console.log(`Spotify search hits: ${summary.spotifySearchHits}`);
    console.log(`Search cache misses: ${summary.searchCacheMisses}`);
    console.log(`Search dedupe hits: ${summary.searchDedupeHits}`);
    console.log(`Join failures: ${summary.joinFailures}`);
    console.log(`Search failures: ${summary.searchFailures}`);
    printSpotifyOperations(report);
    return;
  }

  if (scenarioName === "search-cache") {
    console.log(`Search query: ${summary.query}`);
    console.log(`Wave count: ${summary.waveCount}`);
    console.log(`Wave delay ms: ${summary.waveDelayMs}`);
    console.log(`Backend search hits: ${summary.backendSearchHits}`);
    console.log(`Spotify search hits: ${summary.spotifySearchHits}`);
    console.log(`Search cache hits: ${summary.searchCacheHits}`);
    console.log(`Search cache misses: ${summary.searchCacheMisses}`);
    console.log(`Search dedupe hits: ${summary.searchDedupeHits}`);
    console.log(`Join failures: ${summary.joinFailures}`);
    console.log(`Search failures: ${summary.searchFailures}`);
    printSpotifyOperations(report);
    return;
  }

  if (scenarioName === "add-burst") {
    console.log(`Prefetched track: ${summary.prefetchedTrack}`);
    console.log(`Track uri: ${summary.trackUri || "none"}`);
    console.log(`Backend add hits: ${summary.backendAddHits}`);
    console.log(`Spotify playlist appends: ${summary.spotifyPlaylistAppends}`);
    console.log(`Spotify search hits: ${summary.spotifySearchHits}`);
    console.log(`Flush completed: ${summary.flushCompleted}`);
    console.log(`Flush failures: ${summary.flushFailures}`);
    console.log(`Join failures: ${summary.joinFailures}`);
    console.log(`Action failures: ${summary.actionFailures}`);
    printSpotifyOperations(report);
  }
};

const printSectionDivider = () => {
  console.log("----------------------------------------");
};

const createProgressTracker = ({ label, total, noun }) => {
  const startedAt = Date.now();
  const state = {
    completed: 0,
    ok: 0,
    failed: 0,
  };

  console.log(`${label} started. Total ${noun}: ${total}`);

  return {
    tick: (result) => {
      state.completed += 1;
      state.ok += result?.ok ? 1 : 0;
      state.failed += result?.ok ? 0 : 1;
      const status = result?.ok ? "ok" : `fail:${result?.status || 0}`;
      console.log(
        `${label} ${state.completed}/${total} ${noun} | ok=${state.ok} failed=${state.failed} | last=${status}`
      );
    },
    finish: () => {
      console.log(
        `${label} complete in ${Date.now() - startedAt}ms | total=${total} ok=${state.ok} failed=${state.failed}`
      );
      printSectionDivider();
    },
  };
};

const runTrackedBatch = async ({ items, label, noun, worker }) => {
  const tracker = createProgressTracker({ label, total: items.length, noun });
  const wrappedItems = items.map(async (item, index) => {
    const result = await worker(item, index);
    tracker.tick(result);
    return result;
  });
  const results = await Promise.all(wrappedItems);
  tracker.finish();
  return results;
};

const printPhaseHeader = ({ phaseIndex, phaseCount, scenarioName }) => {
  printSectionDivider();
  console.log(`Phase ${phaseIndex}/${phaseCount}: ${scenarioName}`);
  printSectionDivider();
};

const resetMetrics = async () => {
  const response = await perfClient.post("/__perf/reset");

  if (response.status !== 200) {
    throw new Error(`Failed to reset perf metrics: ${response.status}`);
  }
};

const fetchMetrics = async () => {
  const response = await perfClient.get("/__perf/metrics");

  if (response.status !== 200) {
    throw new Error(`Failed to fetch perf metrics: ${response.status}`);
  }

  return response.data;
};

const joinGuest = async (index) => {
  const response = await perfClient.post("/session/join", {
    sessionId: requireSessionId(),
    name: buildGuestName(index),
  });

  return {
    ok: response.status === 200,
    status: response.status,
    cookie: extractCookieHeader(response.headers),
    body: response.data,
  };
};

const joinGuests = async (count) =>
  runTrackedBatch({
    items: Array.from({ length: count }, (_, index) => index),
    label: "Join phase",
    noun: "joins",
    worker: (index) => joinGuest(index),
  });

const requestWithGuestCookie = (guest, requestConfig) =>
  perfClient.request({
    ...requestConfig,
    headers: {
      ...(requestConfig.headers || {}),
      Cookie: guest.cookie,
    },
  });

const searchGuest = async (guest, query) => {
  const response = await requestWithGuestCookie(guest, {
    method: "GET",
    url: "/spotify/search",
    params: { q: query },
  });

  return {
    ok: response.status === 200,
    status: response.status,
    data: response.data,
  };
};

const addGuestTrack = async (guest, track) => {
  const response = await requestWithGuestCookie(guest, {
    method: "POST",
    url: "/spotify/add",
    data: {
      trackUri: track.uri,
      track: {
        uri: track.uri,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.artwork,
      },
    },
  });

  return {
    ok: response.status === 200,
    status: response.status,
    data: response.data,
  };
};

const buildScenarioContext = (bootstrapGuests) => ({
  bootstrapGuests,
  searchGuest,
  addGuestTrack,
  delay,
  runTrackedBatch,
  printSectionDivider,
  log: console.log,
});

const buildReport = ({ scenarioName, startedAt, joinResults, actionResults, metrics, meta }) => {
  const joinSummary = summarizeResults("joins", joinResults);
  const actionSummary = summarizeResults("actions", Array.isArray(actionResults) ? actionResults : []);

  const report = {
    scenario: scenarioName,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    joins: joinSummary,
    actions: actionSummary,
    meta: meta || {},
    metricsSummary: buildCommonMetricsSummary(metrics),
    spotifyOperations: buildSpotifyOperationSummary(metrics),
    focusSummary: buildScenarioFocusSummary(
      scenarioName,
      metrics,
      joinSummary,
      actionSummary,
      meta || {}
    ),
    metrics,
  };

  report.outputPath = writeReport(scenarioName, report);
  return report;
};

const runScenarioActionsOnly = async ({ scenarioName, bootstrapGuests, joinResults, phaseMeta = null }) => {
  const scenario = scenarioCatalog[scenarioName];
  const startedAt = Date.now();

  if (phaseMeta) {
    printPhaseHeader(phaseMeta);
  }

  await resetMetrics();
  console.log("Metrics reset.");
  console.log(`Bootstrap guests available: ${bootstrapGuests.length}/${joinResults.length}`);
  printSectionDivider();

  const scenarioRun = await scenario.run(buildScenarioContext(bootstrapGuests));

  if (scenario.settleMs || 0) {
    console.log(`Settling for ${scenario.settleMs}ms...`);
  }

  await delay(scenario.settleMs || 0);

  const metrics = await fetchMetrics();
  const report = buildReport({
    scenarioName,
    startedAt,
    joinResults,
    actionResults: scenarioRun.actionResults,
    metrics,
    meta: scenarioRun.meta,
  });

  printScenarioSummary(scenarioName, report);
  printSectionDivider();
  return report;
};

const runScenarioSuite = async (suiteName) => {
  const startedAt = Date.now();
  const subReports = [];
  const joinScenario = scenarioCatalog["join-only"];

  printSectionDivider();
  console.log(`Starting full perf suite with ${suiteOrder.length} phases.`);
  printSectionDivider();

  await resetMetrics();
  console.log("Metrics reset.");
  printPhaseHeader({ phaseIndex: 1, phaseCount: suiteOrder.length, scenarioName: "join-only" });
  const joinStartedAt = Date.now();
  const joinResults = await joinGuests(joinScenario.users);
  const bootstrapGuests = joinResults.filter((result) => result.ok && result.cookie);
  console.log(`Bootstrap guests available: ${bootstrapGuests.length}/${joinResults.length}`);
  printSectionDivider();
  const joinRun = await joinScenario.run(buildScenarioContext(bootstrapGuests));
  if (joinScenario.settleMs || 0) {
    console.log(`Settling for ${joinScenario.settleMs}ms...`);
  }
  await delay(joinScenario.settleMs || 0);
  const joinMetrics = await fetchMetrics();
  const joinReport = buildReport({
    scenarioName: "join-only",
    startedAt: joinStartedAt,
    joinResults,
    actionResults: joinRun.actionResults,
    metrics: joinMetrics,
    meta: joinRun.meta,
  });
  printScenarioSummary("join-only", joinReport);
  printSectionDivider();
  subReports.push(joinReport);

  const remainingScenarios = suiteOrder.filter((scenarioName) => scenarioName !== "join-only");

  for (const [index, scenarioName] of remainingScenarios.entries()) {
    const report = await runScenarioActionsOnly({
      scenarioName,
      bootstrapGuests,
      joinResults,
      phaseMeta: {
        phaseIndex: index + 2,
        phaseCount: suiteOrder.length,
        scenarioName,
      },
    });
    subReports.push(report);
  }

  const aggregate = {
    scenario: suiteName,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    bootstrappedGuests: bootstrapGuests.length,
    subReports: subReports.map((report) => ({
      scenario: report.scenario,
      outputPath: report.outputPath,
      focusSummary: report.focusSummary,
      spotifyOperations: report.spotifyOperations,
    })),
  };

  aggregate.outputPath = writeReport(suiteName, aggregate);
  console.log(`Combined report: ${aggregate.outputPath}`);
  console.log(`Full perf suite complete in ${aggregate.durationMs}ms`);
  return aggregate;
};

const main = async () => {
  requireScenarioName();
  await runScenarioSuite("full");
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
