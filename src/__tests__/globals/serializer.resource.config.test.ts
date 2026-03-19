import { resources, Serializer } from "../../public";
import { RunnerError } from "../../definers/defineError";

describe("global serializer resource config", () => {
  it("exposes a config schema for configured serializer entries", () => {
    expect(resources.serializer.configSchema).toBeDefined();
  });

  it("builds serializer instances from default resource config", async () => {
    const initSerializer = resources.serializer.init;

    expect(initSerializer).toBeDefined();

    const serializer = await initSerializer!(undefined as never, {}, undefined);
    const payload = serializer.stringify({
      metadata: new Map([["ok", true]]),
    });

    expect(serializer.parse(payload)).toEqual({
      metadata: new Map([["ok", true]]),
    });
  });

  it("builds serializer instances from explicit resource config", async () => {
    const parsedConfig = resources.serializer.configSchema?.parse({
      pretty: true,
      allowedTypes: ["Date"],
      symbolPolicy: "disabled",
    });
    const initSerializer = resources.serializer.init;

    expect(parsedConfig).toEqual({
      pretty: true,
      allowedTypes: ["Date"],
      symbolPolicy: "disabled",
    });
    expect(initSerializer).toBeDefined();

    const serializer = await initSerializer!(parsedConfig!, {}, undefined);
    const payload = serializer.stringify({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const blockedPayload = new Serializer().stringify({
      metadata: new Map([["ok", true]]),
    });

    expect(payload).toContain("\n");
    expect(serializer.parse(payload)).toEqual({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(() => serializer.parse(blockedPayload)).toThrow(RunnerError);
  });
});
