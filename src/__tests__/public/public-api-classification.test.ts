import * as fs from "node:fs";
import * as path from "node:path";
import * as universalExports from "../../index";
import * as nodeExports from "../../node";
import * as esDecoratorExports from "../../decorators/es";
import * as legacyDecoratorExports from "../../decorators/legacy";
import { Match } from "../../public";

type ApiClassification = {
  application: string[];
  advanced: string[];
  internalCandidate: string[];
  legacy: string[];
};

const classificationPattern = {
  application: Match.ArrayOf(String),
  advanced: Match.ArrayOf(String),
  internalCandidate: Match.ArrayOf(String),
  legacy: Match.ArrayOf(String),
};

const manifestSchema = Match.compile({
  universal: classificationPattern,
  node: classificationPattern,
  decoratorsEs: classificationPattern,
  decoratorsLegacy: classificationPattern,
});

function readManifest() {
  const manifestPath = path.join(
    process.cwd(),
    "config/public-api/runtime-exports.json",
  );

  return manifestSchema.parse(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  );
}

function flatten(classification: ApiClassification): string[] {
  return [
    ...classification.application,
    ...classification.advanced,
    ...classification.internalCandidate,
    ...classification.legacy,
  ].sort();
}

function expectUniqueClassification(classification: ApiClassification): void {
  const classified = flatten(classification);
  expect(new Set(classified).size).toBe(classified.length);
}

describe("public runtime API classification", () => {
  const manifest = readManifest();

  it("classifies every universal runtime export exactly once", () => {
    expectUniqueClassification(manifest.universal);
    expect(flatten(manifest.universal)).toEqual(
      Object.keys(universalExports).sort(),
    );
  });

  it("classifies every Node-only runtime export exactly once", () => {
    expectUniqueClassification(manifest.node);

    const universalNames = new Set(Object.keys(universalExports));
    const nodeOnlyNames = Object.keys(nodeExports)
      .filter((name) => !universalNames.has(name))
      .sort();

    expect(flatten(manifest.node)).toEqual(nodeOnlyNames);
  });

  it.each([
    ["ES", manifest.decoratorsEs, esDecoratorExports],
    ["legacy", manifest.decoratorsLegacy, legacyDecoratorExports],
  ])(
    "classifies the %s decorator runtime entrypoint",
    (_name, classification, exports) => {
      expectUniqueClassification(classification);
      expect(flatten(classification)).toEqual(Object.keys(exports).sort());
    },
  );
});
