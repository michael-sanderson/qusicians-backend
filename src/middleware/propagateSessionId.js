module.exports = () => (req, res, next) => {
  req.sessionId = req.query?.sessionId || req.headers['x-session-id'];
  if (!req.sessionId) return res.status(400).send("Missing session ID");
  next();
};