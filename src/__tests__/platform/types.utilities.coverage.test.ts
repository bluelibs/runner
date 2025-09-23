import {
  isNode,
  isBrowser,
  isWebWorker,
  isUniversal,
} from "../../platform/types";

describe("platform/types utilities coverage", () => {
  it("covers isNode positive and negative", () => {
    const original = (globalThis as any).process;
    (globalThis as any).process = { versions: { node: "18.0.0" } };
    expect(isNode()).toBe(true);
    delete (globalThis as any).process;
    expect(isNode()).toBe(false);
    (globalThis as any).process = original;
  });

  it("covers isBrowser positive and negative", () => {
    const ow = (globalThis as any).window;
    const od = (globalThis as any).document;
    (globalThis as any).window = {};
    (globalThis as any).document = {};
    expect(isBrowser()).toBe(true);
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    expect(isBrowser()).toBe(false);
    (globalThis as any).window = ow;
    (globalThis as any).document = od;
  });

  it("covers isWebWorker positive and negative", () => {
    const os = (globalThis as any).self;
    const oi = (globalThis as any).importScripts;
    const ow = (globalThis as any).window;
    (globalThis as any).self = {};
    (globalThis as any).importScripts = () => {};
    delete (globalThis as any).window;
    expect(isWebWorker()).toBe(true);
    delete (globalThis as any).self;
    delete (globalThis as any).importScripts;
    expect(isWebWorker()).toBe(false);
    (globalThis as any).self = os;
    (globalThis as any).importScripts = oi;
    (globalThis as any).window = ow;
  });

  it("covers isWebWorker when importScripts exists but window is defined (should be false)", () => {
    const os = (globalThis as any).self;
    const oi = (globalThis as any).importScripts;
    const ow = (globalThis as any).window;
    (globalThis as any).self = {};
    (globalThis as any).importScripts = () => {};
    (globalThis as any).window = {}; // defined -> not a worker
    expect(isWebWorker()).toBe(false);
    (globalThis as any).self = os;
    (globalThis as any).importScripts = oi;
    (globalThis as any).window = ow;
  });

  it("covers isUniversal false-positive cases", () => {
    const op = (globalThis as any).process;
    (globalThis as any).process = { versions: { node: "18.0.0" } };
    expect(isUniversal()).toBe(false);
    delete (globalThis as any).process;
  });

  it("covers isUniversal when only webworker is present (should be false)", () => {
    const ow = (globalThis as any).window;
    const od = (globalThis as any).document;
    const os = (globalThis as any).self;
    const oi = (globalThis as any).importScripts;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    (globalThis as any).self = {};
    (globalThis as any).importScripts = () => {};
    expect(isUniversal()).toBe(false);
    (globalThis as any).window = ow;
    (globalThis as any).document = od;
    (globalThis as any).self = os;
    (globalThis as any).importScripts = oi;
  });

  it("covers isUniversal when only browser is present (should be false)", () => {
    const ow = (globalThis as any).window;
    const od = (globalThis as any).document;
    const op = (globalThis as any).process;
    const os = (globalThis as any).self;
    const oi = (globalThis as any).importScripts;
    delete (globalThis as any).process;
    (globalThis as any).window = {};
    (globalThis as any).document = {};
    delete (globalThis as any).self;
    delete (globalThis as any).importScripts;
    expect(isUniversal()).toBe(false);
    (globalThis as any).window = ow;
    (globalThis as any).document = od;
    (globalThis as any).process = op;
    (globalThis as any).self = os;
    (globalThis as any).importScripts = oi;
  });
});
