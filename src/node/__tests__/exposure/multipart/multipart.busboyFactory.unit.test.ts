import { PassThrough } from "node:stream";
import { Serializer } from "../../../../serializer";

function createReq(): PassThrough & { headers: Record<string, string> } {
  const req = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
  };
  req.headers = { "content-type": "multipart/form-data; boundary=---" };
  return req;
}

describe("multipart busboy interop branches", () => {
  it("uses Busboy default export when present", async () => {
    jest.resetModules();

    const factory = jest.fn(() => new PassThrough());
    jest.doMock("busboy", () => ({ default: factory }));

    // Re-require after mocking so busboyFactory is computed with this module shape
    const { parseMultipartInput } = require("../../../exposure/multipart");

    const req = createReq();
    const promise = parseMultipartInput(req, undefined, new Serializer());
    req.end();

    const out = await promise;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
  });

  it("uses Busboy CJS export when default export is absent", async () => {
    jest.resetModules();

    const factory = jest.fn(() => new PassThrough());
    jest.doMock("busboy", () => factory);

    const { parseMultipartInput } = require("../../../exposure/multipart");

    const req = createReq();
    const promise = parseMultipartInput(req, undefined, new Serializer());
    req.end();

    const out = await promise;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
  });
});
