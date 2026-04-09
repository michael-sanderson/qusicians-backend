module.exports = ({ ttlMs, maxEntries }) => {
  const entries = new Map();

  const isExpired = (entry) => !entry || entry.expiresAt <= Date.now();

  const pruneExpiredEntries = () => {
    entries.forEach((entry, key) => {
      if (isExpired(entry)) {
        entries.delete(key);
      }
    });
  };

  const evictOverflow = () => {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  };

  const get = (key) => {
    const entry = entries.get(key);

    if (isExpired(entry)) {
      entries.delete(key);
      return null;
    }

    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  };

  const set = (key, value) => {
    pruneExpiredEntries();

    entries.delete(key);
    entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    evictOverflow();
    return value;
  };

  return {
    get,
    set,
  };
};
