import * as fs from "fs";
import * as path from "path";

describe("CLI Documentation Extractor", () => {
  const testOutputDir = "/tmp/cli-test-output";
  
  beforeEach(() => {
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }
  });

  test("should validate CLI files exist", () => {
    // Test that the CLI files exist
    expect(fs.existsSync(path.join(__dirname, "../cli.ts"))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "../../bin/runner-cli.js"))).toBe(true);
  });
  
  test("should validate that example project exists", () => {
    const examplePath = path.join(__dirname, "../../examples/documentation-example.ts");
    expect(fs.existsSync(examplePath)).toBe(true);
  });

  test("should validate package.json has bin entry", () => {
    const packageJsonPath = path.join(__dirname, "../../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(packageJson.bin).toBeDefined();
    expect(packageJson.bin.runner).toBe("./bin/runner-cli.js");
  });
});