import { parseMultipartInput } from "../../../exposure/multipart";
import { getDefaultSerializer } from "../../../../serializer";
import { createMockRequest, expectErrorCode } from "./multipart.mock.utils";

jest.mock("busboy", () => {
  class FakeBusboy {
    private handlers: Record<string, Function[]> = Object.create(null);
    on(event: string, cb: Function) { (this.handlers[event] ??= []).push(cb); return this; }
    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        this.handlers[event] = (this.handlers[event] ?? []).filter((f) => f !== wrapper);
        cb(...args);
      };
      (this.handlers[event] ??= []).push(wrapper);
      return this;
    }
    emit(event: string, ...args: any[]) {
      for (const cb of this.handlers[event] ?? []) { try { cb(...args); } catch {} }
    }
  }
  return () => new FakeBusboy();
});

const serializer = getDefaultSerializer();

describe("parseMultipartInput - manifest extra branches", () => {
  const boundary = "----unit-mock-boundary";
  const baseHeaders = { "content-type": `multipart/form-data; boundary=${boundary}` };

  it("field '__manifest' with non-object JSON triggers MISSING_MANIFEST", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", '"hello"', {});
      busboy.emit("finish");
    });
    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("field '__manifest' empty string triggers MISSING_MANIFEST", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", "", {});
      busboy.emit("finish");
    });
    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("enforces files limit when manifest references too many file ids", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const manifest = JSON.stringify({ input: { a: { $runnerFile: "File", id: "F1" }, b: { $runnerFile: "File", id: "F2" } } });
      busboy.emit("field", "__manifest", manifest, {});
    });
    const result = await parseMultipartInput(req, undefined, serializer, { files: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
  });

  it("applies field size limit before parsing the manifest", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", "12345", {});
    });
    const result = await parseMultipartInput(req, undefined, serializer, { fieldSize: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
  });

  it("handleCompletion INVALID_MULTIPART when field handler throws (manifestSeen=true)", async () => {
    const badValue: { [Symbol.toPrimitive]: () => string } = {
      [Symbol.toPrimitive]: (): string => { throw new Error("coercion-error"); },
    };
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", badValue, {});
      busboy.emit("finish");
    });
    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });
});
