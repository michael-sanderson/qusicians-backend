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

  const directIdMatch = trimmed.match(/^[A-Za-z0-9]{22}$/);
  if (directIdMatch) return trimmed;

  const spotifyUriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (spotifyUriMatch) return spotifyUriMatch[1];

  const urlMatch = trimmed.match(
    /^https?:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]{22})(?:[/?#].*)?$/
  );
  if (urlMatch) return urlMatch[1];

  return null;
};

module.exports = {
  formatTrack,
  normalizeTrackMeta,
  resolvePlaylistId,
};
