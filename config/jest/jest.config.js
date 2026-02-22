const os = require("os");
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
  testTimeout: 10000,
  cacheDirectory: path.join(os.tmpdir(), "jest-cache-runner"),
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  testPathIgnorePatterns: ["<rootDir>/src/__tests__/benchmark"],
  moduleNameMapper: {
    "^#/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/__tests__/**",
    "!src/node/__tests__/**",
    "!src/node/durable/dashboard/**",
  ],
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/jest.setup.ts"],
  coverageProvider: "babel",
  coverageDirectory: "coverage",
  coverageReporters: ["text", "json-summary"],
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
