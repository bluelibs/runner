import { nodeExposure } from "../../../exposure/resource";

describe("nodeExposure definition (unit)", () => {
  it("dispose handles values without close()", async () => {
    await expect(
      nodeExposure.dispose?.(
        {} as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    ).resolves.toBeUndefined();

    await expect(
      nodeExposure.dispose?.(
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    ).resolves.toBeUndefined();
  });
});
