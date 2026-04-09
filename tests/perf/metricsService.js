module.exports = (enabled = false) => {
  const state = {
    startedAt: Date.now(),
    counters: {},
    gauges: {},
    timings: {},
  };

  const toKey = (parts) => parts.filter(Boolean).join(".");

  const increment = (parts, amount = 1) => {
    if (!enabled) return;
    const key = Array.isArray(parts) ? toKey(parts) : parts;
    state.counters[key] = (state.counters[key] || 0) + amount;
  };

  const setGauge = (parts, value) => {
    if (!enabled) return;
    const key = Array.isArray(parts) ? toKey(parts) : parts;
    state.gauges[key] = value;
  };

  const observeTiming = (parts, value) => {
    if (!enabled) return;
    const key = Array.isArray(parts) ? toKey(parts) : parts;
    const current = state.timings[key] || {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      avgMs: 0,
    };
    const nextCount = current.count + 1;
    const nextTotalMs = current.totalMs + value;

    state.timings[key] = {
      count: nextCount,
      totalMs: nextTotalMs,
      maxMs: Math.max(current.maxMs, value),
      avgMs: Math.round(nextTotalMs / nextCount),
    };
  };

  const snapshot = () => ({
    enabled,
    startedAt: state.startedAt,
    counters: { ...state.counters },
    gauges: { ...state.gauges },
    timings: { ...state.timings },
  });

  const reset = () => {
    state.startedAt = Date.now();
    state.counters = {};
    state.gauges = {};
    state.timings = {};
    return snapshot();
  };

  return {
    enabled,
    increment,
    setGauge,
    observeTiming,
    snapshot,
    reset,
  };
};
