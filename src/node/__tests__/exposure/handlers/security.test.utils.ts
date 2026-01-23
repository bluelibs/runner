import { Readable } from "stream";

export function createReqRes(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}) {
  const { method = "POST", url = "/", headers = {}, body } = init;
  const req = new Readable({
    read() {},
  }) as any;
  req.method = method;
  req.url = url;
  req.headers = headers;

  const originalPush = req.push.bind(req);
  req.push = (chunk: any) => {
    if (chunk === null) {
      originalPush(null);
    } else {
      originalPush(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  };

  if (body != null) {
    setImmediate(() => {
      req.push(body);
      req.push(null);
    });
  }

  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    write(payload?: any) {
      if (payload != null)
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      this.headersSent = true;
    },
    end(payload?: any) {
      if (payload != null) this.write(payload);
      this.headersSent = true;
      this.writableEnded = true;
    },
  };

  return {
    req,
    res,
    get text() {
      return Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8");
    },
    get json() {
      return JSON.parse(this.text);
    },
    get headers() {
      return res.headers as Record<string, string>;
    },
  };
}
