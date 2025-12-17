// services/oauthStateService.js
//
// OAuth state management service.
// Responsible for generating, storing, validating, and consuming
// short-lived OAuth state values to prevent CSRF attacks.

module.exports = (crypto, redisClient, C) => {
  /* ------------------------------------------------------------------
   * State generation
   * ------------------------------------------------------------------ */

  // Generate a cryptographically secure OAuth state value
  // and persist it temporarily for later validation.
  const generateAndStoreState = async () => {
    const state = crypto.randomBytes(16).toString("hex");

    await redisClient.setEx(
      `${C.STATE_PREFIX}${state}`,
      C.STATE_TTL_SECONDS,
      "valid"
    );

    return state;
  };

  /* ------------------------------------------------------------------
   * State validation
   * ------------------------------------------------------------------ */

  // Validate an OAuth state value and consume it immediately.
  // Returns true if valid, false if missing or expired.
  const verifyAndConsumeState = async (state) => {
    const key = `${C.STATE_PREFIX}${state}`;
    const exists = await redisClient.get(key);

    if (!exists) {
      return false;
    }

    await redisClient.del(key);
    return true;
  };

  /* ------------------------------------------------------------------ */

  return {
    generateAndStoreState,
    verifyAndConsumeState,
  };
};
