const path = require("path");

module.exports = {
  rootDir: path.join(__dirname, "../.."),
  preset: "ts-jest",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/config/ts/tsconfig.jest.json",
        diagnostics: false,
      },
    ],
  },
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/__tests__/benchmark/**/*.test.ts"],
  // Allow longer-running benchmarks
  testTimeout: 60000,
  // Do not include default ignore patterns; run only benchmarks
  testPathIgnorePatterns: [],
  moduleNameMapper: {
    "^#/(.*)$": "<rootDir>/src/$1",
  },
  // Disable coverage for benchmarks to reduce overhead
  collectCoverage: false,
};
