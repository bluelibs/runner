import { r, run } from "../../../index";
import { live, resources } from "../../node";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("live data query input", () => {
  it("uses normalized input for topics and raw input for one task parse", async () => {
    const seenTopics: number[] = [];
    const read = r
      .task("read")
      .inputSchema<{ n: number }>({
        parse(value: { n: number }) {
          return { n: value.n + 1 };
        },
      })
      .run(async ({ n }) => n)
      .build();
    const query = live.query({
      task: read,
      topics: ({ n }) => {
        seenTopics.push(n);
        return live.topic("number", String(n));
      },
    });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(query, { n: 1 });
    await expect(subscription.next()).resolves.toMatchObject({
      value: { data: 2 },
    });
    await liveData.invalidate(live.topic("number", "2"));
    await flush();
    expect(seenTopics).toEqual([2]);
    await runtime.dispose();
  });
});
