import { Match } from "@bluelibs/runner";
import { buildRouteSchema } from "./buildRouteSchema";

describe("buildRouteSchema", () => {
  it("maps meta to summary/description and builds params from path & inputSchema", () => {
    const task: any = {
      meta: {
        title: "Get User By ID",
        description: "Retrieve a single user by its unique identifier",
      },
      inputSchema: Match.compile({ id: Match.NonEmptyString }),
      resultSchema: Match.compile({ ok: Boolean }),
    };
    const config: any = { method: "get", path: "/user/:id" };

    const schema = buildRouteSchema(task, config);

    expect(schema.summary).toBe("Get User By ID");
    expect(schema.description).toMatch(/single user/i);
    expect(schema.body).toBeUndefined(); // GET shouldn't include body
    expect(schema.params).toBeTruthy();
    expect(schema.params.required).toContain("id");
    expect(schema.params.properties.id).toMatchObject({ type: "string" });
    expect(schema.response?.[200]).toBeTruthy();
  });

  it("builds body for non-GET and defaults param types to string when not in inputSchema", () => {
    const task: any = {
      meta: { title: "Create", description: "desc" },
      inputSchema: Match.compile({ name: Match.NonEmptyString }),
      resultSchema: Match.compile({ id: Match.NonEmptyString }),
    };
    const config: any = { method: "post", path: "/things/:id" };

    const schema = buildRouteSchema(task, config);

    expect(schema.body).toBeTruthy();
    expect(schema.params.properties.id).toMatchObject({ type: "string" });
  });
});
