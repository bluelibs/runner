import { extractAuthUser } from "./extractAuthUser";

describe("extractAuthUser", () => {
  it("returns null when no token present", async () => {
    const result = await extractAuthUser({
      request: {},
      auth: { cookieName: "auth", verifyToken: () => null },
      db: { em: () => ({}) },
      extractToken: () => null,
    });
    expect(result).toBeNull();
  });

  it("returns user when token is valid and entity exists", async () => {
    const entity = { id: "1", name: "A", email: "a@test" };
    const db = {
      entities: { User: {} },
      em: () => ({ findOne: async () => entity }),
    };
    const result = await extractAuthUser({
      request: {},
      auth: { cookieName: "auth", verifyToken: () => ({ sub: "1" }) },
      db,
      extractToken: () => "token",
    });
    expect(result).toEqual({ id: entity.id, name: entity.name, email: entity.email });
  });

  it("swallows errors and returns null", async () => {
    const result = await extractAuthUser({
      request: {},
      auth: { cookieName: "auth", verifyToken: () => { throw new Error("bad"); } },
      db: { em: () => ({}) },
      extractToken: () => "token",
    });
    expect(result).toBeNull();
  });
});

