module.exports = (express, spotifyController) => {
  const router = express.Router();

  // Middleware to propagate sessionId from query or header
  const propagateSessionId = require("../../middleware/propagateSessionId")();

  // Public routes — no session needed
  router.get('/login', spotifyController.login);
  router.get('/callback', spotifyController.callback);

  // Routes that require sessionId
  router.get('/queue', propagateSessionId, spotifyController.getQueue);
  // router.get('/search', propagateSessionId, spotifyController.searchTracks);
  // router.post('/add', propagateSessionId, spotifyController.addToQueue);

  return router;
};