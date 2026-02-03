import { PassThrough } from "stream";
import type { IncomingHttpHeaders } from "http";
import {
  parseMultipartInput,
  type MultipartRequest,
} from "../../../exposure/multipart";
import { getDefaultSerializer } from "../../../../serializer";

function makeReq(headers: IncomingHttpHeaders) {
  const req = new PassThrough() as unknown as MultipartRequest;
  req.headers = headers;
  req.method = "POST";
  return req;
}

describe("multipart - signal already aborted triggers onAbort (line 249)", () => {
  it("returns 499 REQUEST_ABORTED when signal.aborted is true", async () => {
    const boundary = "----sigAlreadyAborted";
    const req = makeReq({
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const ac = new AbortController();
    ac.abort();
    const result = await parseMultipartInput(
      req,
      ac.signal,
      getDefaultSerializer(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(499);
      expect((result.response.body as any)?.error?.code).toBe(
        "REQUEST_ABORTED",
      );
    }
  });
});
