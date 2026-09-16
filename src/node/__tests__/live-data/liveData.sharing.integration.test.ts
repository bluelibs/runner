import { r, run } from "../../../index";
import { live, resources } from "../../node";

describe("live data observer sharing", () => {
  it("keeps semantically ordered object inputs in separate observers", async () => {
    let reads = 0;
    const read = r
      .task<{ sort: Record<string, 1> }>("read")
      .run(async ({ sort }) => {
        reads++;
        return Object.keys(sort);
      })
      .build();
    const query = live.query({
      task: read,
      topics: () => live.topic("ordered"),
      share: true,
    });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const first = await liveData.subscribe(query, {
      sort: { createdAt: 1, priority: 1 },
    });
    const second = await liveData.subscribe(query, {
      sort: { priority: 1, createdAt: 1 },
    });

    await expect(first.next()).resolves.toMatchObject({
      value: { data: ["createdAt", "priority"] },
    });
    await expect(second.next()).resolves.toMatchObject({
      value: { data: ["priority", "createdAt"] },
    });
    expect(reads).toBe(2);
    await runtime.dispose();
  });
});
