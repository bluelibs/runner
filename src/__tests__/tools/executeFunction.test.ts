import { executeFunction, executeFunctionSync } from "../../tools/executeFunction";

describe("executeFunction", () => {
  describe("executeFunction", () => {
    it("should execute a synchronous function", async () => {
      const syncFn = (x: number, y: number) => x + y;
      const result = await executeFunction(syncFn, 5, 3);
      expect(result).toBe(8);
    });

    it("should execute an async function", async () => {
      const asyncFn = async (x: number, y: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return x * y;
      };
      const result = await executeFunction(asyncFn, 4, 5);
      expect(result).toBe(20);
    });

    it("should execute a function that returns a resolved Promise", async () => {
      const promiseFn = (x: number) => Promise.resolve(x * 2);
      const result = await executeFunction(promiseFn, 7);
      expect(result).toBe(14);
    });

    it("should execute a function that returns a rejected Promise", async () => {
      const errorFn = (message: string) => Promise.reject(new Error(message));
      await expect(executeFunction(errorFn, "test error")).rejects.toThrow("test error");
    });

    it("should handle functions with no parameters", async () => {
      const noParamFn = () => "hello world";
      const result = await executeFunction(noParamFn);
      expect(result).toBe("hello world");
    });

    it("should handle functions with multiple parameters", async () => {
      const multiParamFn = (a: number, b: string, c: boolean) => ({ a, b, c });
      const result = await executeFunction(multiParamFn, 42, "test", true);
      expect(result).toEqual({ a: 42, b: "test", c: true });
    });

    it("should preserve this context when called with Function.call", async () => {
      const obj = {
        value: 100,
        getValue() {
          return this.value;
        }
      };
      const result = await executeFunction(obj.getValue.bind(obj));
      expect(result).toBe(100);
    });

    it("should handle sync function that throws error", async () => {
      const errorFn = (message: string) => {
        throw new Error(message);
      };
      await expect(executeFunction(errorFn, "sync error")).rejects.toThrow("sync error");
    });

    it("should handle async function that throws error", async () => {
      const asyncErrorFn = async (message: string) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        throw new Error(message);
      };
      await expect(executeFunction(asyncErrorFn, "async error")).rejects.toThrow("async error");
    });
  });

  describe("executeFunctionSync", () => {
    it("should execute a synchronous function", () => {
      const syncFn = (x: number, y: number) => x + y;
      const result = executeFunctionSync(syncFn, 5, 3);
      expect(result).toBe(8);
    });

    it("should throw error for async function", () => {
      const asyncFn = async (x: number) => x * 2;
      expect(() => executeFunctionSync(asyncFn, 5)).toThrow(
        "Function returned a Promise but synchronous execution was expected"
      );
    });

    it("should throw error for function returning Promise", () => {
      const promiseFn = (x: number) => Promise.resolve(x * 2);
      expect(() => executeFunctionSync(promiseFn, 5)).toThrow(
        "Function returned a Promise but synchronous execution was expected"
      );
    });

    it("should execute function with no parameters", () => {
      const noParamFn = () => "hello";
      const result = executeFunctionSync(noParamFn);
      expect(result).toBe("hello");
    });

    it("should execute function with multiple parameters", () => {
      const multiParamFn = (a: number, b: string) => `${a}-${b}`;
      const result = executeFunctionSync(multiParamFn, 42, "test");
      expect(result).toBe("42-test");
    });

    it("should handle sync function that throws error", () => {
      const errorFn = (message: string) => {
        throw new Error(message);
      };
      expect(() => executeFunctionSync(errorFn, "sync error")).toThrow("sync error");
    });

    it("should preserve this context", () => {
      const obj = {
        value: 50,
        getValue() {
          return this.value;
        }
      };
      const result = executeFunctionSync(obj.getValue.bind(obj));
      expect(result).toBe(50);
    });

    it("should handle undefined return value", () => {
      const undefinedFn = () => undefined;
      const result = executeFunctionSync(undefinedFn);
      expect(result).toBeUndefined();
    });

    it("should handle null return value", () => {
      const nullFn = () => null;
      const result = executeFunctionSync(nullFn);
      expect(result).toBeNull();
    });

    it("should handle falsy return values", () => {
      const falsyFn = (type: string) => {
        switch (type) {
          case "false": return false;
          case "zero": return 0;
          case "empty": return "";
          case "null": return null;
          case "undefined": return undefined;
          default: return "default";
        }
      };
      
      expect(executeFunctionSync(falsyFn, "false")).toBe(false);
      expect(executeFunctionSync(falsyFn, "zero")).toBe(0);
      expect(executeFunctionSync(falsyFn, "empty")).toBe("");
      expect(executeFunctionSync(falsyFn, "null")).toBe(null);
      expect(executeFunctionSync(falsyFn, "undefined")).toBe(undefined);
    });
  });
});