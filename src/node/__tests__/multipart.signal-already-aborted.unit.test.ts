import { PassThrough } from "stream";
import type { IncomingHttpHeaders } from "http";
import { parseMultipartInput } from "../exposure/multipart";

function makeReq(headers: IncomingHttpHeaders) {
  const req: any = new PassThrough();
  req.headers = headers;
  req.method = "POST";
  return req as any;
}

describe("multipart - signal already aborted triggers onAbort (line 249)", () => {
  it("returns 499 REQUEST_ABORTED when signal.aborted is true", async () => {
    const boundary = "----sigAlreadyAborted";
    const req = makeReq({
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const ac = new AbortController();
    ac.abort();
    const result = await parseMultipartInput(req as any, ac.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(499);
      expect((result.response.body as any)?.error?.code).toBe(
        "REQUEST_ABORTED",
      );
    }
  });
});
