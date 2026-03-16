import { describe, expect, it } from "@jest/globals";
import * as vm from "node:vm";
import * as ts from "typescript";
import * as legacyDecorators from "../../decorators/legacy";

describe("legacy decorator transpile", () => {
  it("compiles and executes legacy decorator syntax with experimentalDecorators", () => {
    const source = `
      const { Match, Serializer } = require("@bluelibs/runner/decorators/legacy");

      @Match.Schema()
      class UserDto {
        @Serializer.Field({ from: "user_id" })
        @Match.Field(Match.NonEmptyString)
        id;
      }

      module.exports = { Match, Serializer, UserDto };
    `;

    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: false,
        useDefineForClassFields: false,
      },
      reportDiagnostics: true,
    });

    expect(transpiled.diagnostics).toEqual([]);

    const module = { exports: {} as Record<string, unknown> };
    const context = {
      module,
      exports: module.exports,
      require: (specifier: string): unknown => {
        if (specifier === "@bluelibs/runner/decorators/legacy") {
          return legacyDecorators;
        }

        throw new Error(`Unexpected require: ${specifier}`);
      },
    };

    vm.runInNewContext(transpiled.outputText, context);

    const { Serializer, UserDto } = module.exports as {
      Serializer: {
        new (): {
          deserialize(payload: string, options: { schema: unknown }): unknown;
        };
      };
      UserDto: unknown;
    };

    const serializer = new Serializer();
    const deserialized = serializer.deserialize('{"user_id":"u1"}', {
      schema: UserDto,
    }) as { id: string };

    expect(deserialized).toBeInstanceOf(UserDto as never);
    expect(deserialized).toEqual({
      id: "u1",
    });
  });

  it("preserves circular references for legacy decorator class schemas", () => {
    const source = `
      const { Match, Serializer } = require("@bluelibs/runner/decorators/legacy");

      @Match.Schema()
      class NodeDto {
        @Match.Field(Match.NonEmptyString)
        id;

        @Match.Field(Match.Optional(Match.fromSchema(() => NodeDto)))
        parent;

        @Match.Field(Match.Optional(Match.fromSchema(() => NodeDto)))
        sibling;

        @Match.Field(Match.ArrayOf(Match.fromSchema(() => NodeDto)))
        children;
      }

      module.exports = { Serializer, NodeDto };
    `;

    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: false,
        useDefineForClassFields: false,
      },
      reportDiagnostics: true,
    });

    expect(transpiled.diagnostics).toEqual([]);

    const module = { exports: {} as Record<string, unknown> };
    const context = {
      module,
      exports: module.exports,
      require: (specifier: string): unknown => {
        if (specifier === "@bluelibs/runner/decorators/legacy") {
          return legacyDecorators;
        }

        throw new Error(`Unexpected require: ${specifier}`);
      },
    };

    vm.runInNewContext(transpiled.outputText, context);

    const { Serializer, NodeDto } = module.exports as {
      Serializer: {
        new (): {
          serialize(value: unknown): string;
          deserialize(payload: string, options: { schema: unknown }): unknown;
        };
      };
      NodeDto: new () => {
        id: string;
        parent?: unknown;
        sibling?: unknown;
        children: unknown[];
      };
    };

    const serializer = new Serializer();
    const left: Record<string, unknown> = { id: "left", children: [] };
    const right: Record<string, unknown> = { id: "right", children: [] };
    const root: Record<string, unknown> = {
      id: "root",
      children: [left, right],
    };

    left.parent = root;
    right.parent = root;
    left.sibling = right;
    right.sibling = left;

    const payload = serializer.serialize(root);
    const deserialized = serializer.deserialize(payload, {
      schema: NodeDto,
    }) as InstanceType<typeof NodeDto>;

    expect(deserialized).toBeInstanceOf(NodeDto);
    expect(deserialized.children[0]).toBeInstanceOf(NodeDto);
    expect(deserialized.children[1]).toBeInstanceOf(NodeDto);
    expect(
      (deserialized.children[0] as InstanceType<typeof NodeDto>).parent,
    ).toBe(deserialized);
    expect(
      (deserialized.children[1] as InstanceType<typeof NodeDto>).parent,
    ).toBe(deserialized);
    expect(
      (deserialized.children[0] as InstanceType<typeof NodeDto>).sibling,
    ).toBe(deserialized.children[1]);
    expect(
      (deserialized.children[1] as InstanceType<typeof NodeDto>).sibling,
    ).toBe(deserialized.children[0]);
  });
});
