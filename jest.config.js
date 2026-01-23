const os = require("os");
const path = require("path");

module.exports = {
  preset: "ts-jest",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { isolatedModules: true }],
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
