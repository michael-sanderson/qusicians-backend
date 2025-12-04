// Root router factory — mounts all feature routers

module.exports = ({ express, spotifyController }) => {
  const router = express.Router();
  const buildSpotifyRoutes = require("./spotify/spotifyRoutes");

  // Spotify feature routes
  router.use("/spotify", buildSpotifyRoutes(express, spotifyController));

  // Catch-all for unmatched routes
  router.use((req, res) => {
    res.status(404).send("Not found");
  });

  return router;
};
