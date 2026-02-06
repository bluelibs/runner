import { PassThrough } from "node:stream";
import { parseMultipartInput } from "../../../exposure/multipart";
import { Serializer } from "../../../../serializer";
import {
  createMockRequest,
  expectErrorCode,
  type FakeStream,
} from "./multipart.mock.utils";

jest.mock("busboy", () => {
  class FakeBusboy {
    private handlers: Record<string, Function[]> = Object.create(null);
    on(event: string, cb: Function) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        this.handlers[event] = (this.handlers[event] ?? []).filter(
          (f) => f !== wrapper,
        );
        cb(...args);
      };
      (this.handlers[event] ??= []).push(wrapper);
      return this;
    }
    emit(event: string, ...args: any[]) {
      for (const cb of this.handlers[event] ?? []) {
        try {
          cb(...args);
        } catch {}
      }
    }
  }
  return () => new FakeBusboy();
});

const serializer = new Serializer();

describe("parseMultipartInput - streams extra branches", () => {
  const boundary = "----unit-mock-boundary";
  const baseHeaders = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };

  it("file stream emits error triggers STREAM_ERROR", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const fileStream: FakeStream = {
        on(event: string, cb: Function) {
          if (event === "error") setImmediate(() => cb(new Error("boom")));
          return fileStream;
        },
        pipe() {},
        resume() {},
      };
      busboy.emit("file", "file:ID1", fileStream, {
        filename: "a.txt",
        mimeType: "text/plain",
      });
    });
    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "STREAM_ERROR");
  });

  it("fails when file handler hits files limit and resumes the stream", async () => {
    const resumeSpy = jest.fn();
    const req = createMockRequest(baseHeaders, (busboy) => {
      const mkStream = () => ({
        on() {
          return this;
        },
        pipe() {},
        resume: resumeSpy,
      });
      busboy.emit("file", "file:F1", mkStream(), {
        filename: "a.txt",
        mimeType: "text/plain",
      });
      busboy.emit("file", "file:F2", mkStream(), {
        filename: "b.txt",
        mimeType: "text/plain",
      });
    });
    const result = await parseMultipartInput(req, undefined, serializer, {
      files: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
    expect(resumeSpy).toHaveBeenCalled();
  });

  it("falls back to ending streams if destroy throws", async () => {
    const originalDestroy = PassThrough.prototype.destroy;
    const originalEnd = PassThrough.prototype.end;
    let ended = false;
    PassThrough.prototype.destroy = function () {
      throw new Error("nope");
    };
    PassThrough.prototype.end = function (this: any, ...args: any[]) {
      ended = true;
      return (originalEnd as any).apply(this, args);
    };

    try {
      const req = createMockRequest(baseHeaders, (busboy) => {
        const manifest = JSON.stringify({
          input: { f: { $runnerFile: "File", id: "F1" } },
        });
        busboy.emit("field", "__manifest", manifest, {});
        busboy.emit("finish");
      });
      await parseMultipartInput(req, undefined, serializer);
      expect(ended).toBe(true);
    } finally {
      PassThrough.prototype.destroy = originalDestroy;
      PassThrough.prototype.end = originalEnd;
    }
  });

  it("busboy emits error triggers INVALID_MULTIPART", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      setImmediate(() => busboy.emit("error", new Error("bad")));
    });
    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });
});
