import { extractResourceAndConfig } from "../../tools/extractResourceAndConfig";
import { defineResource } from "../../define";

describe("extractResourceAndConfig", () => {
  const resource = defineResource<{ port: number }>({
    id: "extract-test-resource",
    init: async (config) => config.port,
  });

  it("extracts resource and config from a resource-with-config", () => {
    const rwc = resource.with({ port: 3000 });
    const result = extractResourceAndConfig(rwc);

    expect(result.resource).toBe(resource);
    expect(result.config).toEqual({ port: 3000 });
  });

  it("returns the resource and undefined config for a bare resource", () => {
    const bareResource = defineResource({
      id: "extract-test-bare",
      init: async () => "value",
    });

    const result = extractResourceAndConfig(bareResource);

    expect(result.resource).toBe(bareResource);
    expect(result.config).toBeUndefined();
  });
});
