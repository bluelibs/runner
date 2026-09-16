import { r } from "../../../index";
import { createMemoryLiveDataProvider } from "../../live-data/memoryProvider";
import { query } from "../../live-data/query";
import { normalizeTopics, topic, topicKey } from "../../live-data/topic";
import type { LiveTopic } from "../../live-data/types";

describe("live-data query contracts", () => {
  const task = r
    .task("live-query-contract-task")
    .run(async () => "value")
    .build();
  const changed = topic("records", "changed");

  it("applies immutable defaults and preserves explicit scheduling options", () => {
    const defaults = query({ task, topics: () => changed });
    expect(defaults).toMatchObject({
      task,
      share: false,
      batchWindowMs: 0,
      revalidateEveryMs: undefined,
      asyncContexts: [],
    });
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(Object.isFrozen(defaults.asyncContexts)).toBe(true);

    const configured = query({
      task,
      topics: () => changed,
      share: true,
      batchWindowMs: 10,
      revalidateEveryMs: 50,
      asyncContexts: [],
    });
    expect(configured).toMatchObject({
      share: true,
      batchWindowMs: 10,
      revalidateEveryMs: 50,
    });
  });

  it.each([
    ["negative batch window", { batchWindowMs: -1 }, /non-negative integer/],
    ["fractional batch window", { batchWindowMs: 0.5 }, /non-negative integer/],
    ["zero revalidation", { revalidateEveryMs: 0 }, /positive integer/],
    ["fractional revalidation", { revalidateEveryMs: 0.5 }, /positive integer/],
  ])("rejects %s", (_label, options, message) => {
    expect(() => query({ task, topics: () => changed, ...options })).toThrow(
      message,
    );
  });

  it("requires a topic selector function", () => {
    expect(() =>
      query({
        task,
        topics: undefined as unknown as () => LiveTopic,
      }),
    ).toThrow(/topics must be a function/);
  });
});

describe("live-data topic contracts", () => {
  it("creates frozen exact keys and normalizes duplicate topics", () => {
    const first = topic("billing", "invoices");
    const duplicate = topic("billing", "invoices");
    expect(first).toEqual({ segments: ["billing", "invoices"] });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.segments)).toBe(true);
    expect(topicKey(first)).toBe('["billing","invoices"]');
    expect(normalizeTopics(first)).toEqual([first]);
    expect(normalizeTopics([first, duplicate])).toEqual([duplicate]);
  });

  it("rejects invalid topic sizes and segments", () => {
    expect(() => topic()).toThrow(/between 1 and 32 segments/);
    expect(() => topic(...Array.from({ length: 33 }, () => "segment"))).toThrow(
      /between 1 and 32 segments/,
    );
    expect(() => topic(1 as unknown as string)).toThrow(/non-empty strings/);
    expect(() => topic("")).toThrow(/non-empty strings/);
    expect(() => topic("x".repeat(257))).toThrow(/non-empty strings/);
  });

  it("rejects malformed keys and empty query topic sets", () => {
    expect(() => topicKey(undefined as unknown as LiveTopic)).toThrow(
      /Expected a topic created by/,
    );
    expect(() =>
      topicKey({ segments: "invalid" } as unknown as LiveTopic),
    ).toThrow(/Expected a topic created by/);
    expect(() => topicKey({ segments: [""] } as unknown as LiveTopic)).toThrow(
      /non-empty strings/,
    );
    expect(() => normalizeTopics([])).toThrow(/at least one topic/);
  });
});

describe("memory live-data provider", () => {
  it("routes only intersecting topics and releases registrations", async () => {
    const provider = createMemoryLiveDataProvider();
    const billing = jest.fn();
    const support = jest.fn();
    const closeBilling = await provider.subscribe(
      ["billing", "shared"],
      billing,
    );
    await provider.subscribe(["support", "shared"], support);

    await provider.publish(["unrelated"]);
    expect(billing).not.toHaveBeenCalled();
    expect(support).not.toHaveBeenCalled();

    await provider.publish(["billing"]);
    expect(billing).toHaveBeenCalledWith({
      type: "invalidate",
      topics: ["billing"],
    });
    expect(support).not.toHaveBeenCalled();

    await provider.publish(["shared"]);
    expect(billing).toHaveBeenCalledTimes(2);
    expect(support).toHaveBeenCalledTimes(1);

    await closeBilling();
    await provider.publish(["billing"]);
    expect(billing).toHaveBeenCalledTimes(2);

    await provider.dispose();
    await provider.publish(["support"]);
    expect(support).toHaveBeenCalledTimes(1);
    expect(provider.connected).toBe(true);
  });
});
