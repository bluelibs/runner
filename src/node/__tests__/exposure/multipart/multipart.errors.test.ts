import { parseMultipartInput } from "../../../exposure/multipart";
import { Serializer } from "../../../../serializer";
import {
  createMultipartRequest,
  part,
  expectErrorCode,
  createErroringRequest,
  createRequestFromBody,
} from "./multipart.test.utils";
import {
  createMessageError,
  nodeExposureMultipartLimitExceededError,
} from "../../../../errors";

const serializer = new Serializer();

describe("parseMultipartInput - Errors", () => {
  const boundary = "----jest-boundary";

  it("fails when manifest is missing", async () => {
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:A"; filename="foo.txt"',
          "Content-Type: application/octet-stream",
        ],
        "abc",
      ),
    ]);
    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok)
      throw createMessageError(
        "Expected multipart failure for missing manifest",
      );
    expectErrorCode(parsed.response, "MISSING_MANIFEST");
  });

  it("fails when manifest JSON is invalid", async () => {
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        "not-json",
      ),
    ]);
    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok)
      throw createMessageError(
        "Expected multipart failure for invalid manifest",
      );
    expectErrorCode(parsed.response, "INVALID_MULTIPART");
  });

  it("propagates request stream errors", async () => {
    const req = createErroringRequest(boundary, new Error("boom"));
    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      const finalize = await parsed.finalize;
      if (finalize.ok)
        throw createMessageError("Expected finalize to report request abort");
      expectErrorCode(finalize.response, "REQUEST_ABORTED");
      return;
    }
    expectErrorCode(parsed.response, "REQUEST_ABORTED");
  });

  it("reports multipart parser errors (missing boundary)", async () => {
    const req = createRequestFromBody("irrelevant", {
      "content-type": "multipart/form-data",
    });
    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      const finalize = await parsed.finalize;
      if (finalize.ok)
        throw createMessageError(
          "Expected missing boundary to be treated as invalid",
        );
      expectErrorCode(finalize.response, "INVALID_MULTIPART");
      return;
    }
    expectErrorCode(parsed.response, "INVALID_MULTIPART");
  });

  it("finalize surfaces missing file part errors", async () => {
    const manifest = JSON.stringify({
      input: {
        file: { $runnerFile: "File", id: "F1", meta: { name: "late.txt" } },
      },
    });
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        manifest,
      ),
    ]);
    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (!parsed.ok)
      throw createMessageError("Expected success before finalize");
    const finalize = await parsed.finalize;
    if (finalize.ok)
      throw createMessageError("Expected finalize to report missing file part");
    expectErrorCode(finalize.response, "MISSING_FILE_PART");
  });

  it("falls back safely when multipart limit error has no response payload", async () => {
    const manifest = JSON.stringify({
      input: {
        file: { $runnerFile: "File", id: "F1", meta: { name: "late.txt" } },
      },
    });
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        manifest,
      ),
    ]);

    const originalCreate = nodeExposureMultipartLimitExceededError.create.bind(
      nodeExposureMultipartLimitExceededError,
    );
    const errorHelperPrototype = Object.getPrototypeOf(
      nodeExposureMultipartLimitExceededError,
    ) as {
      create: (...args: any[]) => Error;
    };
    const originalPrototypeCreate = errorHelperPrototype.create;
    const createSpy = jest
      .spyOn(errorHelperPrototype, "create")
      .mockImplementation(function (this: unknown, ...args: any[]) {
        if (this !== nodeExposureMultipartLimitExceededError) {
          return originalPrototypeCreate.call(this, ...args);
        }
        return originalCreate({ message: "Multipart limit exceeded" } as any);
      });

    try {
      const parsed = await parseMultipartInput(req, undefined, serializer, {
        files: 0,
      });
      if (parsed.ok) {
        throw createMessageError(
          "Expected invalid multipart when response payload is missing",
        );
      }
      expectErrorCode(parsed.response, "INVALID_MULTIPART");
    } finally {
      createSpy.mockRestore();
    }
  });
});
