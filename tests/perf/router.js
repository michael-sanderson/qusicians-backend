module.exports = (express, perfMetrics) => {
  const router = express.Router();

  router.get("/metrics", (req, res) => {
    res.json(perfMetrics.snapshot());
  });

  router.post("/reset", (req, res) => {
    res.json(perfMetrics.reset());
  });

  return router;
};
