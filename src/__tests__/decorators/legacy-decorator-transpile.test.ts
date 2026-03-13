import { describe, expect, it } from "@jest/globals";
import * as vm from "node:vm";
import * as ts from "typescript";

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
          return require("../../decorators/legacy");
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
    expect(
      serializer.deserialize('{"user_id":"u1"}', { schema: UserDto }),
    ).toEqual({
      id: "u1",
    });
  });
});
