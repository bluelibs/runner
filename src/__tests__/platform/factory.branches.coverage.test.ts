import { createPlatformAdapter } from "../../platform/factory";
import { NodePlatformAdapter } from "../../platform/adapters/node";
import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import { UniversalPlatformAdapter } from "../../platform/adapters/universal";

describe("platform factory branches coverage", () => {
  let originalTarget: any;

  beforeAll(() => {
    originalTarget = (globalThis as any).__TARGET__;
  });
  afterAll(() => {
    if (originalTarget !== undefined) (globalThis as any).__TARGET__ = originalTarget;
    else delete (globalThis as any).__TARGET__;
  });

  afterEach(() => {
    if (originalTarget !== undefined) (globalThis as any).__TARGET__ = originalTarget;
    else delete (globalThis as any).__TARGET__;
  });

  it("returns NodePlatformAdapter when __TARGET__=node", () => {
    (globalThis as any).__TARGET__ = "node";
    const a = createPlatformAdapter();
    expect(a).toBeInstanceOf(NodePlatformAdapter);
  });

  it("returns BrowserPlatformAdapter when __TARGET__=browser", () => {
    (globalThis as any).__TARGET__ = "browser";
    const a = createPlatformAdapter();
    expect(a).toBeInstanceOf(BrowserPlatformAdapter);
  });

  it("returns EdgePlatformAdapter when __TARGET__=edge", () => {
    (globalThis as any).__TARGET__ = "edge";
    const a = createPlatformAdapter();
    expect(a).toBeInstanceOf(EdgePlatformAdapter);
  });

  it("returns UniversalPlatformAdapter when __TARGET__ is undefined", () => {
    delete (globalThis as any).__TARGET__;
    const a = createPlatformAdapter();
    expect(a).toBeInstanceOf(UniversalPlatformAdapter);
  });
});


