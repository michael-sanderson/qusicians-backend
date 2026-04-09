const normalizeSearchQuery = (query) => {
  if (typeof query !== "string") return "";

  return query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

module.exports = {
  normalizeSearchQuery,
};
