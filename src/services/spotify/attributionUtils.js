const resolveAddedBy = (actor, guest, hostProfileImageUrl = null) => {
  if (actor?.role === "host") {
    return {
      name: "Host",
      role: "host",
      avatarDataUrl: hostProfileImageUrl,
    };
  }

  const name =
    typeof actor?.displayName === "string" ? actor.displayName.trim() : "";
  const avatarDataUrl = guest?.avatarDataUrl || actor?.avatarDataUrl || null;

  return {
    name: name || "Host",
    role: "guest",
    avatarDataUrl,
  };
};

const normalizeAddedBy = (value) => {
  if (!value) {
    return {
      name: "Host",
      role: "host",
      avatarDataUrl: null,
    };
  }

  if (typeof value === "string") {
    return {
      name: value.trim() || "Host",
      role: value.trim().toLowerCase() === "host" ? "host" : "guest",
      avatarDataUrl: null,
    };
  }

  return {
    name: value.name || "Host",
    role: value.role || "guest",
    avatarDataUrl: value.avatarDataUrl || null,
  };
};

const normalizeAttributions = (raw) => {
  if (!raw) return {};

  if (Array.isArray(raw)) {
    return raw.reduce((acc, entry) => {
      if (entry?.uri) {
        acc[entry.uri] = normalizeAddedBy(entry.addedBy);
      }
      return acc;
    }, {});
  }

  if (typeof raw === "object") {
    return Object.keys(raw).reduce((acc, uri) => {
      acc[uri] = normalizeAddedBy(raw[uri]);
      return acc;
    }, {});
  }

  return {};
};

const resolveGuestByName = (guests, displayName) => {
  const normalizedDisplayName =
    typeof displayName === "string" ? displayName.trim().toLowerCase() : "";

  if (!normalizedDisplayName || !Array.isArray(guests)) {
    return null;
  }

  return (
    guests.find(
      (guest) =>
        typeof guest?.name === "string" &&
        guest.name.trim().toLowerCase() === normalizedDisplayName
    ) || null
  );
};

module.exports = {
  resolveAddedBy,
  normalizeAddedBy,
  normalizeAttributions,
  resolveGuestByName,
};

