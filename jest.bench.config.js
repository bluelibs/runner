module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/__tests__/benchmark/**/*.test.ts"],
  // Allow longer-running benchmarks
  testTimeout: 60000,
  // Do not include default ignore patterns; run only benchmarks
  testPathIgnorePatterns: [],
  // Disable coverage for benchmarks to reduce overhead
  collectCoverage: false,
};
