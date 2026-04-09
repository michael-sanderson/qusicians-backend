const defaultUsers = Number(process.env.PERF_USERS || 80);

const getSharedSearchQuery = () => process.env.PERF_SEARCH_QUERY || "drake";
const getCacheWaveCount = () => Number(process.env.PERF_CACHE_WAVES || 4);
const getCacheWaveDelayMs = () => Number(process.env.PERF_CACHE_WAVE_DELAY_MS || 750);

const scenarioCatalog = {
  "join-only": {
    name: "join-only",
    users: defaultUsers,
    settleMs: 250,
    run: async ({ bootstrapGuests, log, printSectionDivider }) => {
      log("Join-only phase has no post-join actions.");
      printSectionDivider();

      return {
        bootstrappedGuests: bootstrapGuests,
        actionResults: [],
      };
    },
  },
  "search-dedupe": {
    name: "search-dedupe",
    settleMs: 1000,
    run: async ({ bootstrapGuests, searchGuest, runTrackedBatch, log, printSectionDivider }) => {
      const sharedQuery = getSharedSearchQuery();
      log(`Search dedupe query: ${sharedQuery}`);
      printSectionDivider();

      const actionResults = await runTrackedBatch({
        items: bootstrapGuests,
        label: "Search dedupe phase",
        noun: "searches",
        worker: (guest) => searchGuest(guest, sharedQuery),
      });

      return {
        bootstrappedGuests: bootstrapGuests,
        actionResults,
        meta: {
          query: sharedQuery,
        },
      };
    },
  },
  "search-cache": {
    name: "search-cache",
    settleMs: 500,
    run: async ({ bootstrapGuests, searchGuest, delay, runTrackedBatch, log, printSectionDivider }) => {
      const sharedQuery = getSharedSearchQuery();
      const waveCount = getCacheWaveCount();
      const waveDelayMs = getCacheWaveDelayMs();
      const firstGuest = bootstrapGuests[0];

      log(`Search cache query: ${sharedQuery}`);
      log(`Search cache waves: ${waveCount}`);
      log(`Search cache wave delay: ${waveDelayMs}ms`);
      printSectionDivider();

      const warmupResults = firstGuest
        ? await runTrackedBatch({
            items: [firstGuest],
            label: "Search cache warmup",
            noun: "searches",
            worker: (guest) => searchGuest(guest, sharedQuery),
          })
        : [];

      const runWave = async (waveIndex) => {
        if (waveIndex >= waveCount) {
          return [];
        }

        log(`Waiting ${waveDelayMs}ms before cache wave ${waveIndex + 1}/${waveCount}...`);
        await delay(waveDelayMs);
        const waveResults = await runTrackedBatch({
          items: bootstrapGuests,
          label: `Search cache wave ${waveIndex + 1}/${waveCount}`,
          noun: "searches",
          worker: (guest) => searchGuest(guest, sharedQuery),
        });
        const laterResults = await runWave(waveIndex + 1);

        return [...waveResults, ...laterResults];
      };

      const actionResults = [...warmupResults, ...(await runWave(0))];

      return {
        bootstrappedGuests: bootstrapGuests,
        actionResults,
        meta: {
          query: sharedQuery,
          waveCount,
          waveDelayMs,
          warmupRequests: warmupResults.length,
        },
      };
    },
  },
  "add-burst": {
    name: "add-burst",
    settleMs: Number(process.env.PERF_ADD_SETTLE_MS || 17000),
    run: async ({ bootstrapGuests, searchGuest, addGuestTrack, runTrackedBatch, log, printSectionDivider }) => {
      const sharedQuery = getSharedSearchQuery();
      const firstGuest = bootstrapGuests[0];

      log(`Add burst prefetch query: ${sharedQuery}`);
      printSectionDivider();

      const warmupResults = firstGuest
        ? await runTrackedBatch({
            items: [firstGuest],
            label: "Add burst prefetch",
            noun: "searches",
            worker: (guest) => searchGuest(guest, sharedQuery),
          })
        : [];
      const warmupSearch = warmupResults[0] || null;
      const firstTrack =
        warmupSearch?.ok && Array.isArray(warmupSearch.data) ? warmupSearch.data[0] : null;

      if (!firstTrack) {
        log("No prefetched track available. Add burst skipped.");
        printSectionDivider();

        return {
          bootstrappedGuests: bootstrapGuests,
          actionResults: warmupResults,
          meta: {
            query: sharedQuery,
            prefetchedTrack: false,
          },
        };
      }

      log(`Add burst track uri: ${firstTrack.uri}`);
      printSectionDivider();

      const addResults = await runTrackedBatch({
        items: bootstrapGuests,
        label: "Add burst phase",
        noun: "adds",
        worker: (guest) => addGuestTrack(guest, firstTrack),
      });

      return {
        bootstrappedGuests: bootstrapGuests,
        actionResults: [...warmupResults, ...addResults],
        meta: {
          query: sharedQuery,
          prefetchedTrack: true,
          trackUri: firstTrack.uri,
        },
      };
    },
  },
};

const suiteOrder = ["join-only", "search-dedupe", "search-cache", "add-burst"];

module.exports = {
  scenarioCatalog,
  suiteOrder,
};
