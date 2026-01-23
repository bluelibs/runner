import { PassThrough } from "stream";
import type { IncomingHttpHeaders } from "http";
import { parseMultipartInput } from "../../exposure/multipart";
import { getDefaultSerializer } from "../../../serializer";

function makeReq(headers: IncomingHttpHeaders) {
  const req: any = new PassThrough();
  req.headers = headers;
  req.method = "POST";
  return req as any;
}

describe("multipart - signal addEventListener branch (line 249)", () => {
  it("attaches listener when signal not already aborted", async () => {
    const boundary = "----sigBoundary";
    const req = makeReq({
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const ac = new AbortController();
    const resultPromise = parseMultipartInput(
      req as any,
      ac.signal,
      getDefaultSerializer(),
    );
    const body = `--${boundary}\r\nContent-Disposition: form-data; name=\"__manifest\"\r\n\r\n{\"input\":{}}\r\n--${boundary}--\r\n`;
    req.write(body);
    req.end();
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    // finalize should resolve ok without aborting
    const finalizeResult = await (result as any).finalize;
    expect(finalizeResult.ok).toBe(true);
  });
});
