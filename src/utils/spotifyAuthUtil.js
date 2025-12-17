// utils/spotifyAuthUtil.js
//
// Factory that returns a function to generate a Spotify OAuth
// authorization URL for a given state parameter.

module.exports = (config) => (state) =>
  `${config.SPOTIFY.AUTHORIZE_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    scope: config.SPOTIFY.SCOPES,
    redirect_uri: config.redirectUri,
    state,
  }).toString()}`;
