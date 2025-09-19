import { createPlatformAdapter } from "../../platform/factory";
import type { IPlatformAdapter } from "../../platform/types";

describe("platform adapters ultimate", () => {
  it("returns an IPlatformAdapter", () => {
    const a: IPlatformAdapter = createPlatformAdapter();
    expect(["node", "browser", "edge", "universal"]).toContain(a.id);
  });
});
