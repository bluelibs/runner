import * as path from "path";
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
import { assertDefinitionId } from "../../definers/assertDefinitionId";
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
    'rejects ids that contain "." for $label',
    ({ create }) => {
      expect(() => create("bad.id")).toThrow(/cannot contain "\."/i);
    },
  );

  it.each(definitionFactories)(
    "rejects reserved standalone ids for $label",
    ({ create }) => {
      expect(() => create("resources")).toThrow(/reserved by Runner/i);
    },
  );

  it.each(definitionFactories)(
    "rejects reserved framework dotted namespaces for non-framework callers for $label",
    ({ create }) => {
      expect(() => create("runner.tags.userDefined")).toThrow(
        /cannot contain "\."/i,
      );
      expect(() => create("system.events.userDefined")).toThrow(
        /cannot contain "\."/i,
      );
    },
  );

  it("allows runner/system dotted ids for framework-owned source files", () => {
    const sourceCallerFilePath = path.resolve(
      __dirname,
      "../../globals/globalTags.ts",
    );
    const distCallerFilePath = path.resolve(
      __dirname,
      "../../../dist/universal/globals/globalEvents.js",
    );

    expect(() =>
      assertDefinitionId("Tag", "runner.tags.internal", {
        callerFilePath: sourceCallerFilePath,
      }),
    ).not.toThrow();

    expect(() =>
      assertDefinitionId("Event", "system.events.ready", {
        callerFilePath: distCallerFilePath,
      }),
    ).not.toThrow();
  });

  it("rejects runner/system dotted ids when caller file path is missing", () => {
    expect(() => assertDefinitionId("Tag", "runner.tags.internal")).toThrow(
      /cannot contain "\."/i,
    );
  });

  it("rejects runner/system dotted ids for callers outside the package", () => {
    const externalCallerFilePath = path.resolve(
      __dirname,
      "../../../../external.ts",
    );

    expect(() =>
      assertDefinitionId("Tag", "runner.tags.internal", {
        callerFilePath: externalCallerFilePath,
      }),
    ).toThrow(/cannot contain "\."/i);
  });

  it("rejects runner/system dotted ids for relative caller paths", () => {
    expect(() =>
      assertDefinitionId("Tag", "runner.tags.internal", {
        callerFilePath: "src/globals/globalTags.ts",
      }),
    ).toThrow(/cannot contain "\."/i);
  });

  it("rejects runner/system dotted ids for parent-relative caller paths", () => {
    expect(() =>
      assertDefinitionId("Tag", "runner.tags.internal", {
        callerFilePath: "../external.ts",
      }),
    ).toThrow(/cannot contain "\."/i);
  });

  it("rejects runner/system dotted ids when caller path points at the package root", () => {
    const packageRootPath = path.resolve(__dirname, "../../..");

    expect(() =>
      assertDefinitionId("Tag", "runner.tags.internal", {
        callerFilePath: packageRootPath,
      }),
    ).toThrow(/cannot contain "\."/i);
  });
});
