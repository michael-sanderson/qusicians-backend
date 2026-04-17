module.exports = {
  testEnvironment: "node",
  clearMocks: true,
  restoreMocks: true,
  testMatch: ["**/tests/unit/**/*.test.js"],
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/backend.zip",
  ],
};
