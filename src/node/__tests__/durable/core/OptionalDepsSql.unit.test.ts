import { genericError } from "../../../../errors";
import type * as SqliteMod from "../../../durable/optionalDeps/sqlite";
import type * as PgMod from "../../../durable/optionalDeps/pg";

const mockLoaderState: {
  loadSqlite: () => unknown;
  loadPg: () => unknown;
} = {
  loadSqlite: () => ({}),
  loadPg: () => ({}),
};

jest.mock("node:module", () => {
  const actual =
    jest.requireActual<typeof import("node:module")>("node:module");
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === "node:sqlite") return mockLoaderState.loadSqlite();
      if (id === "pg") return mockLoaderState.loadPg();
      return actual.createRequire(`${process.cwd()}/__runner_require__.js`)(id);
    },
  };
});

describe("durable: optional SQL dependency loaders", () => {
  it("openSqliteDatabase handles missing, non-Error throw, invalid export, valid export, and caching", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockLoaderState.loadSqlite = () => {
        throw genericError.new({ message: "no sqlite" });
      };
      const {
        openSqliteDatabase,
      }: typeof SqliteMod = require("../../../durable/optionalDeps/sqlite");
      expect(() => openSqliteDatabase(":memory:")).toThrow(/node:sqlite/);
    });

    jest.resetModules();
    jest.isolateModules(() => {
      mockLoaderState.loadSqlite = () => {
        throw "string-fail";
      };
      const {
        openSqliteDatabase,
      }: typeof SqliteMod = require("../../../durable/optionalDeps/sqlite");
      expect(() => openSqliteDatabase(":memory:")).toThrow(/string-fail/);
    });

    for (const invalidModule of [null, { DatabaseSync: "not-a-fn" }]) {
      jest.resetModules();
      jest.isolateModules(() => {
        mockLoaderState.loadSqlite = () => invalidModule;
        const {
          openSqliteDatabase,
        }: typeof SqliteMod = require("../../../durable/optionalDeps/sqlite");
        expect(() => openSqliteDatabase(":memory:")).toThrow(/DatabaseSync/);
      });
    }

    jest.resetModules();
    jest.isolateModules(() => {
      let loads = 0;
      class FakeSqliteDb {
        constructor(public readonly location: string) {}
        exec() {}
        prepare() {
          return {
            run() {},
            get() {
              return undefined;
            },
            all() {
              return [];
            },
          };
        }
        close() {}
      }
      mockLoaderState.loadSqlite = () => {
        loads += 1;
        return { DatabaseSync: FakeSqliteDb };
      };
      const {
        openSqliteDatabase,
      }: typeof SqliteMod = require("../../../durable/optionalDeps/sqlite");
      expect(openSqliteDatabase("a.db")).toBeInstanceOf(FakeSqliteDb);
      expect(openSqliteDatabase("b.db")).toBeInstanceOf(FakeSqliteDb);
      expect(loads).toBe(1);
    });
  });

  it("createPgPool handles missing, non-Error throw, invalid export, named/default Pool, and caching", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockLoaderState.loadPg = () => {
        throw genericError.new({ message: "Cannot find pg" });
      };
      const {
        createPgPool,
      }: typeof PgMod = require("../../../durable/optionalDeps/pg");
      expect(() => createPgPool("postgres://localhost/db")).toThrow(/pg/);
    });

    jest.resetModules();
    jest.isolateModules(() => {
      mockLoaderState.loadPg = () => {
        throw "raw-pg-err";
      };
      const {
        createPgPool,
      }: typeof PgMod = require("../../../durable/optionalDeps/pg");
      expect(() => createPgPool({ host: "localhost" })).toThrow(/raw-pg-err/);
    });

    for (const invalidModule of [
      null,
      "bad",
      {},
      { default: null },
      { default: {} },
    ]) {
      jest.resetModules();
      jest.isolateModules(() => {
        mockLoaderState.loadPg = () => invalidModule;
        const {
          createPgPool,
        }: typeof PgMod = require("../../../durable/optionalDeps/pg");
        expect(() => createPgPool("postgres://localhost/db")).toThrow(/Pool/);
      });
    }

    jest.resetModules();
    jest.isolateModules(() => {
      let loads = 0;
      class FakePool {
        constructor(public readonly cfg: unknown) {}
        async query() {
          return { rows: [] };
        }
        async connect() {
          return {
            async query() {
              return { rows: [] };
            },
            release() {},
          };
        }
      }
      mockLoaderState.loadPg = () => {
        loads += 1;
        return { Pool: FakePool };
      };
      const {
        createPgPool,
      }: typeof PgMod = require("../../../durable/optionalDeps/pg");
      expect(
        (createPgPool("postgres://u:p@h/db") as unknown as FakePool).cfg,
      ).toEqual({
        connectionString: "postgres://u:p@h/db",
      });
      expect((createPgPool({ max: 2 }) as unknown as FakePool).cfg).toEqual({
        max: 2,
      });
      expect(loads).toBe(1);
    });

    jest.resetModules();
    jest.isolateModules(() => {
      class DefaultPool {
        constructor(public readonly cfg: unknown) {}
        async query() {
          return { rows: [] };
        }
        async connect() {
          return {
            async query() {
              return { rows: [] };
            },
            release() {},
          };
        }
      }
      mockLoaderState.loadPg = () => ({ default: { Pool: DefaultPool } });
      const {
        createPgPool,
      }: typeof PgMod = require("../../../durable/optionalDeps/pg");
      expect(createPgPool("postgres://local/db")).toBeInstanceOf(DefaultPool);
    });
  });
});
