const formatTrack = (track) => {
  if (!track) return null;

  return {
    title: track.name,
    artist: track.artists[0].name,
    album: track.album.name,
    artwork: track.album.images[0].url,
    uri: track.uri,
  };
};

const normalizeTrackMeta = (track) => {
  if (!track || typeof track !== "object") return null;

  return {
    title: typeof track.title === "string" ? track.title : null,
    artist: typeof track.artist === "string" ? track.artist : null,
    album: typeof track.album === "string" ? track.album : null,
    artwork: typeof track.artwork === "string" ? track.artwork : null,
  };
};

const resolvePlaylistId = (input) => {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();

  if (!trimmed) return null;

  return /^[A-Za-z0-9]{22}$/.test(trimmed) ? trimmed : null;
};

module.exports = {
  formatTrack,
  normalizeTrackMeta,
  resolvePlaylistId,
};

