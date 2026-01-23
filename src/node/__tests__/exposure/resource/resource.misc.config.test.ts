import * as http from "http";
import { defineResource, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

describe("nodeExposure - misc config branches", () => {
  const TOKEN = "unit-secret";
  const dummyEvent = defineEvent<{ x?: number }>({ id: "unit.exposure.misc.event" });

  it("normalizes basePath (ensure leading slash + trim trailing)", async () => {
    const externalServer = http.createServer();
    const exposure1 = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: externalServer, basePath: "runner", auth: { token: TOKEN } } });
    const app1 = defineResource({ id: "unit.exposure.misc.app1", register: [dummyEvent, exposure1] });
    const rr1 = await run(app1);
    const handlers1 = await rr1.getResourceValue(exposure1.resource as any);
    expect(handlers1.basePath).toBe("/runner");
    await rr1.dispose();

    const exposure2 = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: externalServer, basePath: "/trimmed/", auth: { token: TOKEN } } });
    const app2 = defineResource({ id: "unit.exposure.misc.app2", register: [dummyEvent, exposure2] });
    const rr2 = await run(app2);
    const handlers2 = await rr2.getResourceValue(exposure2.resource as any);
    expect(handlers2.basePath).toBe("/trimmed");
    await rr2.dispose();
    externalServer.close();
  });

  it("init handles undefined http config and defaults basePath", async () => {
    const exposure = nodeExposure.with({});
    const app = defineResource({ id: "unit.exposure.misc.app4", register: [dummyEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    expect(handlers.basePath).toBe("/__runner");
    expect(handlers.server).toBeNull();
    await rr.dispose();
  });
});
