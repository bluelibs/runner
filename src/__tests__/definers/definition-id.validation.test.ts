import {
  defineEvent,
  defineEventLane,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineRpcLane,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { defineAsyncContext } from "../../definers/defineAsyncContext";
import { defineError } from "../../definers/defineError";

type DefinitionFactory = {
  label: string;
  create: (id: string) => unknown;
};

const definitionFactories: DefinitionFactory[] = [
  {
    label: "task",
    create: (id) =>
      defineTask({
        id,
        run: async () => undefined,
      }),
  },
  {
    label: "resource",
    create: (id) =>
      defineResource({
        id,
      }),
  },
  {
    label: "event",
    create: (id) =>
      defineEvent({
        id,
      }),
  },
  {
    label: "hook",
    create: (id) =>
      defineHook({
        id,
        on: "*",
        run: async () => undefined,
      }),
  },
  {
    label: "task middleware",
    create: (id) =>
      defineTaskMiddleware({
        id,
        run: async ({ next, task }) => next(task.input),
      }),
  },
  {
    label: "resource middleware",
    create: (id) =>
      defineResourceMiddleware({
        id,
        run: async ({ next }) => next(),
      }),
  },
  {
    label: "tag",
    create: (id) =>
      defineTag({
        id,
      }),
  },
  {
    label: "error",
    create: (id) =>
      defineError({
        id,
      }),
  },
  {
    label: "async context",
    create: (id) =>
      defineAsyncContext({
        id,
      }),
  },
  {
    label: "rpc lane",
    create: (id) =>
      defineRpcLane({
        id,
      }),
  },
  {
    label: "event lane",
    create: (id) =>
      defineEventLane({
        id,
      }),
  },
];

describe("definition id validation", () => {
  it("rejects empty and non-string ids with fail-fast diagnostics", () => {
    expect(() =>
      defineTask({
        id: "" as unknown as string,
        run: async () => undefined,
      }),
    ).toThrow(/<empty>/i);

    expect(() =>
      defineTask({
        id: "   " as unknown as string,
        run: async () => undefined,
      }),
    ).toThrow(/must be a non-empty string/i);

    expect(() =>
      defineTask({
        id: 42 as unknown as string,
        run: async () => undefined,
      }),
    ).toThrow(/42/);
  });

  it.each(definitionFactories)(
    "rejects ids that start with a dot for $label",
    ({ create }) => {
      expect(() => create(".bad.id")).toThrow(/cannot start or end with/i);
    },
  );

  it.each(definitionFactories)(
    "rejects ids that end with a dot for $label",
    ({ create }) => {
      expect(() => create("bad.id.")).toThrow(/cannot start or end with/i);
    },
  );

  it.each(definitionFactories)(
    "rejects ids with empty segments for $label",
    ({ create }) => {
      expect(() => create("bad..id")).toThrow(/empty dot-separated segments/i);
    },
  );

  it.each(definitionFactories)(
    "rejects reserved standalone ids for $label",
    ({ create }) => {
      expect(() => create("resources")).toThrow(/reserved by Runner/i);
    },
  );
});
