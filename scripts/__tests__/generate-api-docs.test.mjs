import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("../generate-api-docs.mjs", import.meta.url),
);
const validSource =
  "/** Greet a caller. */\nexport function greet(name: string): string { return name; }\n";

function generate(source, options, verify, args = []) {
  const directory = mkdtempSync(join(tmpdir(), "runner-docs-test-"));
  try {
    writeFileSync(join(directory, "index.ts"), source);
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          types: [],
          skipLibCheck: true,
        },
        files: ["index.ts"],
      }),
    );
    const config = join(directory, "typedoc.json");
    writeFileSync(
      config,
      JSON.stringify({
        name: "Documentation fixture",
        entryPoints: ["./index.ts"],
        tsconfig: "./tsconfig.json",
        out: "./docs",
        readme: "none",
        disableGit: true,
        sourceLinkTemplate: "https://example.test/source/{path}#L{line}",
        ...options,
      }),
    );
    const result = spawnSync(
      process.execPath,
      [script, "--options", config, ...args],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.ifError(result.error);
    verify(result, join(directory, "docs"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("generates HTML for an explicit entry with relative config paths", () => {
  generate(validSource, {}, (result, docs) => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      readFileSync(join(docs, "index.html"), "utf8"),
      /Documentation fixture/,
    );
    const functionPage = readFileSync(
      join(docs, "functions/greet.html"),
      "utf8",
    );
    assert.match(functionPage, /Greet a caller/);
    assert.match(functionPage, /https:\/\/example\.test\/source\/index\.ts#L2/);
  });
});

test("fails before output when TypeScript rejects the source", () => {
  generate("export const invalid: string = 123;", {}, (result, docs) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TS2322/);
    assert.equal(existsSync(docs), false);
  });
});

test("rejects glob entry points rather than invoking legacy discovery", () => {
  for (const pattern of ["./*.ts", `./${"**/../".repeat(30)}*.ts`]) {
    generate(validSource, { entryPoints: [pattern] }, (result, docs) => {
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /entry point must be an explicit source file/,
      );
      assert.equal(existsSync(docs), false);
    });
  }
});

test("honors validation warnings configured as errors", () => {
  const source =
    "/** Calls {@link MissingType}. */\nexport function greet(): void {}";
  generate(
    source,
    { treatValidationWarningsAsErrors: true },
    (result, docs) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /MissingType/);
      assert.equal(existsSync(docs), false);
    },
  );
});

test("honors appended CLI options and emit none", () => {
  generate(
    validSource,
    {},
    (result, docs) => {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(docs), false);
    },
    ["--emit", "none"],
  );
});

test("fails on invalid configuration instead of using fallback options", () => {
  generate(validSource, { nonexistentOption: true }, (result, docs) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /nonexistentOption/);
    assert.equal(existsSync(docs), false);
  });
});
