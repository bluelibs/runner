import { r, run } from "../..";
import { overrideDuplicateTargetError } from "../../errors";

const cases = [
  {
    kind: "resource",
    create: () => {
      const target = r
        .resource("target")
        .init(async () => "base")
        .build();
      return {
        register: [target],
        overrides: [
          r.override(target, async () => "first"),
          r.override(target, async () => "second"),
        ],
      };
    },
  },
  {
    kind: "task",
    create: () => {
      const target = r
        .task("target")
        .run(async () => "base")
        .build();
      return {
        register: [target],
        overrides: [
          r.override(target, async () => "first"),
          r.override(target, async () => "second"),
        ],
      };
    },
  },
  {
    kind: "hook",
    create: () => {
      const event = r.event("event").build();
      const target = r
        .hook("target")
        .on(event)
        .run(async () => {})
        .build();
      return {
        register: [event, target],
        overrides: [
          r.override(target, async () => {}),
          r.override(target, async () => {}),
        ],
      };
    },
  },
  {
    kind: "task middleware",
    create: () => {
      const target = r.middleware
        .task("target")
        .run(async ({ next }) => next())
        .build();
      return {
        register: [target],
        overrides: [
          r.override(target, async ({ next }) => next()),
          r.override(target, async ({ next }) => next()),
        ],
      };
    },
  },
  {
    kind: "resource middleware",
    create: () => {
      const target = r.middleware
        .resource("target")
        .run(async ({ next }) => next())
        .build();
      return {
        register: [target],
        overrides: [
          r.override(target, async ({ next }) => next()),
          r.override(target, async ({ next }) => next()),
        ],
      };
    },
  },
];

describe.each(cases)("duplicate $kind override declarations", ({ create }) => {
  describe.each(["dev", "pre-prod", "prod", "test"] as const)(
    "%s mode",
    (mode) => {
      it.each([false, true])(
        "rejects repeats on one resource (same replacement: %s)",
        async (reuseReplacement) => {
          const { register, overrides } = create();
          const first = overrides[0];
          const second = reuseReplacement ? first : overrides[1];
          const app = r
            .resource("app")
            .register(register)
            .overrides([first, second])
            .build();
          await expect(run(app, { mode })).rejects.toMatchObject({
            id: overrideDuplicateTargetError.id,
            data: { targetId: "target", sources: ["app"] },
          });
        },
      );
    },
  );
});
