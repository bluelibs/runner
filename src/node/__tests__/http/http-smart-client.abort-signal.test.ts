import * as http from "http";
import { Readable, Writable } from "stream";
import { createHttpSmartClient } from "../../http/http-smart-client.model";
import { Serializer } from "../../../serializer";
import { createNodeFile } from "../../files";

function createAbortAwareSink() {
  const sink = new Writable({
    write(_chunk, _encoding, next) {
      next();
    },
    final(next) {
      next();
    },
  }) as Writable & {
    destroy: (error?: Error) => Writable;
    setTimeout: () => Writable;
  };

  sink.setTimeout = () => sink;
  sink.destroy = (error?: Error) => {
    if (error) {
      setImmediate(() => sink.emit("error", error));
    }
    return sink;
  };

  return sink;
}

describe("createHttpSmartClient abort signals", () => {
  const baseUrl = "http://127.0.0.1:5555/__runner";
  const serializer = new Serializer();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("aborts JSON requests through the caller signal", async () => {
    const controller = new AbortController();
    controller.abort("json cancelled");

    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });

    try {
      await client.task("json.abort", { ok: true } as any, {
        signal: controller.signal,
      });
      fail("Expected JSON request to abort");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("json cancelled");
    }
  });

  it("cleans up JSON abort listeners after a successful response", async () => {
    const controller = new AbortController();

    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const payload = serializer.stringify({ ok: true, result: 11 });
      const res = Readable.from([payload]);
      (res as any).headers = { "content-type": "application/json" };
      cb(res as any);
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });

    await expect(
      client.task("json.success", { ok: true } as any, {
        signal: controller.signal,
      }),
    ).resolves.toBe(11);
  });

  it("aborts multipart requests through the caller signal", async () => {
    const controller = new AbortController();
    controller.abort("multipart cancelled");

    jest.spyOn(http, "request").mockImplementation((_opts: any, _cb: any) => {
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });

    try {
      await client.task(
        "multipart.abort",
        {
          file: createNodeFile(
            { name: "upload.txt" },
            { buffer: Buffer.from("hello") },
            "FILE1",
          ),
        } as any,
        { signal: controller.signal },
      );
      fail("Expected multipart request to abort");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("multipart cancelled");
    }
  });

  it("cleans up multipart abort listeners after a successful response", async () => {
    const controller = new AbortController();

    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const payload = serializer.stringify({ ok: true, result: "uploaded" });
      const res = Readable.from([payload]);
      (res as any).headers = { "content-type": "application/json" };
      setImmediate(() => cb(res as any));
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });

    await expect(
      client.task(
        "multipart.success",
        {
          file: createNodeFile(
            { name: "upload.txt" },
            { buffer: Buffer.from("hello") },
            "FILE2",
          ),
        } as any,
        { signal: controller.signal },
      ),
    ).resolves.toBe("uploaded");
  });

  it("aborts octet-stream requests through the caller signal", async () => {
    const controller = new AbortController();
    controller.abort("octet cancelled");

    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = new Readable({ read() {} });
      (res as any).headers = { "content-type": "application/octet-stream" };
      setImmediate(() => cb(res as any));
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });

    try {
      await client.task("octet.abort", Readable.from(["hello"]) as any, {
        signal: controller.signal,
      });
      fail("Expected octet request to abort");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("octet cancelled");
    }
  });

  it("keeps octet-stream requests alive when the caller signal is present but not aborted", async () => {
    const controller = new AbortController();

    jest.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      const res = new Readable({
        read() {
          this.push("stream-ok");
          this.push(null);
        },
      });
      (res as any).headers = { "content-type": "application/octet-stream" };
      setImmediate(() => cb(res as any));
      return createAbortAwareSink() as any;
    }) as any;

    const client = createHttpSmartClient({ baseUrl, serializer });
    const output = (await client.task(
      "octet.success",
      Readable.from(["hi"]) as any,
      {
        signal: controller.signal,
      },
    )) as Readable;

    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      output.on("data", (chunk) => {
        chunks.push(String(chunk));
      });
      output.on("end", resolve);
      output.on("error", reject);
    });

    expect(chunks.join("")).toBe("stream-ok");
  });
});
