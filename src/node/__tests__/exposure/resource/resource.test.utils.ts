import { getDefaultSerializer } from "../../../../serializer";

export function createReqRes(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  manualPush?: boolean;
}) {
  const {
    method = "POST",
    url = "/",
    headers = {},
    body = "",
    manualPush = false,
  } = init;

  const { Readable } = require("stream");
  const req: any = new Readable({
    read() {
      if (!manualPush) {
        if (body != null) {
          this.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
        }
        this.push(null);
      }
    },
  });
  req.method = method;
  req.url = url;
  req.headers = headers;

  let statusCode = 0;
  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    setHeader() {
      /* no-op */
    },
    end(payload?: any) {
      statusCode = this.statusCode;
      if (payload != null) {
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      }
    },
  };

  type JsonResponse = {
    ok?: boolean;
    result?: any;
    error?: { code?: string; message?: string; id?: string; data?: unknown };
  };

  return {
    req,
    res,
    get status() {
      return statusCode;
    },
    get resStatus() {
      return res.statusCode as number;
    },
    get json(): JsonResponse | undefined {
      if (chunks.length === 0) return undefined;
      try {
        return getDefaultSerializer().parse(
          Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
        ) as JsonResponse;
      } catch {
        return undefined;
      }
    },
  };
}
