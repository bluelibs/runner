import { parseMultipartInput } from "../../../exposure/multipart";
import { Serializer } from "../../../../serializer";
import {
  createMultipartRequest,
  part,
  assertInputFile,
} from "./multipart.test.utils";
import type { InputFile } from "../../../../types/inputFile";

const serializer = new Serializer();

function assertFilePair(
  value: unknown,
): asserts value is { fileA: InputFile; fileB: InputFile } {
  if (!value || typeof value !== "object") {
    throw new Error("Expected multipart value to contain files");
  }
  const record = value as { fileA?: unknown; fileB?: unknown };
  assertInputFile(record.fileA, "fileA");
  assertInputFile(record.fileB, "fileB");
}

describe("parseMultipartInput - Hydration", () => {
  const boundary = "----jest-boundary";

  it("hydrates manifest input, skips unrelated fields, and preserves manifest metadata", async () => {
    const manifest = JSON.stringify({
      input: {
        fileA: {
          $runnerFile: "File",
          id: "A",
          meta: {
            name: "override.txt",
            type: "text/plain",
            lastModified: 123,
            extra: { kind: "manifest" },
          },
        },
        fileB: {
          $runnerFile: "File",
          id: "B",
          meta: { name: "placeholder.bin" },
        },
      },
    });
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        ['Content-Disposition: form-data; name="ignored"'],
        "noop",
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        manifest,
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:A"; filename="foo.txt"',
          "Content-Type: application/octet-stream",
        ],
        "abc",
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:B"; filename="bar.bin"',
          "Content-Type: application/octet-stream",
        ],
        "xyz",
      ),
    ]);

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (!parsed.ok) throw new Error("Expected multipart success");

    assertFilePair(parsed.value);
    const { fileA, fileB } = parsed.value;

    expect(fileA.name).toBe("override.txt");
    expect(fileA.type).toBe("text/plain");
    expect(fileA.lastModified).toBe(123);
    expect(fileA.extra).toEqual({ kind: "manifest" });
    expect(fileB.name).toBe("placeholder.bin");
    expect(fileB.type).toBe("application/octet-stream");

    const finalize = await parsed.finalize;
    expect(finalize.ok).toBe(true);
  });
});
