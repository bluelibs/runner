describe("platform types utilities", () => {
  const save = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    self: (globalThis as any).self,
    importScripts: (globalThis as any).importScripts,
    process: (globalThis as any).process,
  };

  afterEach(() => {
    (globalThis as any).window = save.window;
    (globalThis as any).document = save.document;
    (globalThis as any).self = save.self;
    (globalThis as any).importScripts = save.importScripts;
    (globalThis as any).process = save.process;
    jest.resetModules();
  });

  it("detects browser", () => {
    jest.isolateModules(() => {
      (globalThis as any).window = {};
      (globalThis as any).document = {};
      const { isBrowser, isWebWorker, isNode } = require("../platform/types");
      expect(isBrowser()).toBe(true);
      expect(isWebWorker()).toBe(false);
      expect(isNode()).toBe(!!((globalThis as any).process && (globalThis as any).process.versions?.node));
    });
  });

  it("detects web worker", () => {
    jest.isolateModules(() => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      (globalThis as any).self = {};
      (globalThis as any).importScripts = function () {};
      const { isBrowser, isWebWorker } = require("../platform/types");
      expect(isBrowser()).toBe(false);
      expect(isWebWorker()).toBe(true);
    });
  });

  it("detects node", () => {
    jest.isolateModules(() => {
      (globalThis as any).process = { versions: { node: "20.x" } };
      const { isNode } = require("../platform/types");
      expect(isNode()).toBe(true);
    });
  });
});
