import { defineRpcLane, isRpcLane } from "../../define";
import { rpcLaneInvalidIdError } from "../../errors";
import { definitions, r } from "../..";

describe("rpc lane builder", () => {
  it("builds rpc lanes via defineRpcLane", () => {
    const lane = defineRpcLane({
      id: "tests.rpc-lanes.direct",
      meta: { title: "Direct RPC Lane" },
    });

    expect(lane.id).toBe("tests.rpc-lanes.direct");
    expect(lane.meta.title).toBe("Direct RPC Lane");
    expect(isRpcLane(lane)).toBe(true);
    expect(
      (lane as unknown as Record<symbol, unknown>)[definitions.symbolFilePath],
    ).toContain("rpcLane.builder.test");
  });

  it("defaults meta to empty object when defineRpcLane meta is omitted", () => {
    const lane = defineRpcLane({
      id: "tests.rpc-lanes.direct.no-meta",
    });

    expect(lane.meta).toEqual({});
    expect(isRpcLane(lane)).toBe(true);
  });

  it("builds rpc lanes via r.rpcLane()", () => {
    const lane = r
      .rpcLane("tests.rpc-lanes.builder")
      .title("RPC Lane")
      .description("test")
      .build();

    expect(lane.id).toBe("tests.rpc-lanes.builder");
    expect(lane.meta).toEqual({
      title: "RPC Lane",
      description: "test",
    });
    expect(isRpcLane(lane)).toBe(true);
  });

  it("allows replacing metadata via .meta()", () => {
    const lane = r
      .rpcLane("tests.rpc-lanes.builder.meta")
      .meta({
        title: "Meta title",
        docsOrder: 2,
      })
      .build();

    expect(lane.meta).toEqual({
      title: "Meta title",
      docsOrder: 2,
    });
  });

  it("supports applyTo() with task/event definitions and ids", () => {
    const task = r
      .task("tests.rpc-lanes.builder.apply-to.task")
      .run(async () => "ok")
      .build();
    const event = r.event("tests.rpc-lanes.builder.apply-to.event").build();

    const lane = r
      .rpcLane("tests.rpc-lanes.builder.apply-to")
      .applyTo([
        task,
        event,
        "tests.rpc-lanes.builder.apply-to.task",
        "tests.rpc-lanes.builder.apply-to.event",
      ])
      .build();

    expect(lane.applyTo).toEqual([
      task,
      event,
      "tests.rpc-lanes.builder.apply-to.task",
      "tests.rpc-lanes.builder.apply-to.event",
    ]);
  });

  it("supports applyTo() predicate", () => {
    const task = r
      .task("tests.rpc-lanes.builder.apply-to.predicate.task")
      .run(async () => "ok")
      .build();
    const event = r.event("tests.rpc-lanes.builder.apply-to.predicate.event").build();

    const lane = r
      .rpcLane("tests.rpc-lanes.builder.apply-to.predicate.lane")
      .applyTo((candidate) => candidate.id === task.id || candidate.id === event.id)
      .build();

    const applyTo = lane.applyTo;
    expect(typeof applyTo).toBe("function");
    if (typeof applyTo !== "function") {
      throw new Error("Expected applyTo predicate");
    }
    expect(applyTo(task)).toBe(true);
    expect(applyTo(event)).toBe(true);
  });

  it("supports lane-level async context allowlist", () => {
    const context = r.asyncContext("tests.rpc-lanes.builder.ctx").build();
    const lane = r
      .rpcLane("tests.rpc-lanes.builder.contexts")
      .asyncContexts([context, "tests.rpc-lanes.builder.ctx"])
      .build();

    expect(lane.asyncContexts).toEqual([
      context,
      "tests.rpc-lanes.builder.ctx",
    ]);
  });

  it("builds frozen topology with lane-aware profile typing helper", () => {
    const laneA = r.rpcLane("tests.rpc-lanes.topology.helper.a").build();
    const laneB = r.rpcLane("tests.rpc-lanes.topology.helper.b").build();

    const communicator = r
      .resource("tests.rpc-lanes.communicator")
      .init(async () => ({
        task: async () => "ok",
      }))
      .build();

    const topology = r.rpcLane.topology({
      profiles: {
        api: { serve: [laneB] },
      },
      bindings: [
        { lane: laneA, communicator },
        { lane: laneB, communicator },
      ],
    });

    expect(topology.profiles.api.serve).toEqual([laneB]);
    expect(Object.isFrozen(topology)).toBe(true);
  });

  it("fails fast when rpc lane id is empty", () => {
    try {
      defineRpcLane({
        id: "",
      } as unknown as Parameters<typeof defineRpcLane>[0]);
      throw new Error("Expected defineRpcLane to throw");
    } catch (error) {
      expect(rpcLaneInvalidIdError.is(error)).toBe(true);
      expect((error as Error).message).toContain(
        "rpcLane id must be a non-empty string",
      );
    }
  });

  it("fails fast when rpc lane id is not a string", () => {
    try {
      defineRpcLane({
        id: 42 as unknown as string,
      } as unknown as Parameters<typeof defineRpcLane>[0]);
      throw new Error("Expected defineRpcLane to throw");
    } catch (error) {
      expect(rpcLaneInvalidIdError.is(error)).toBe(true);
      expect((error as Error).message).toContain('Received "42"');
    }
  });
});
