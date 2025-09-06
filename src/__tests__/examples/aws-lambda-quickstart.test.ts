import { handler as lambdalith } from "../../../examples/aws-lambda-quickstart/src/handler.lambdalith";
import { handler as getUser } from "../../../examples/aws-lambda-quickstart/src/handlers/getUser";
import { handler as createUser } from "../../../examples/aws-lambda-quickstart/src/handlers/createUser";

function makeCtx() {
  return { awsRequestId: `req-${Math.random().toString(36).slice(2)}` };
}

function parse(res: any) {
  return { ...res, json: JSON.parse(res.body || "null") };
}

describe("examples/aws-lambda-quickstart", () => {
  it("lambdalith flow: POST /users then GET /users/{id}", async () => {
    // GET first should 404
    const res404 = parse(
      await lambdalith(
        {
          requestContext: { http: { method: "GET" } },
          rawPath: "/users/1",
          headers: {},
        },
        makeCtx(),
      ),
    );
    expect(res404.statusCode).toBe(404);

    // Create user
    const created = parse(
      await lambdalith(
        {
          requestContext: { http: { method: "POST" } },
          rawPath: "/users",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Ada" }),
          isBase64Encoded: false,
        },
        makeCtx(),
      ),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({ id: expect.any(String), name: "Ada" });

    const id = created.json.id;

    // GET should return the created user
    const res200 = parse(
      await lambdalith(
        {
          requestContext: { http: { method: "GET" } },
          rawPath: `/users/${id}`,
          headers: {},
        },
        makeCtx(),
      ),
    );
    expect(res200.statusCode).toBe(200);
    expect(res200.json).toEqual({ id, name: "Ada" });
  });

  it("per-route flow: POST then GET", async () => {
    // POST
    const created = parse(
      await createUser(
        {
          requestContext: { http: { method: "POST" } },
          rawPath: "/users",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Grace" }),
          isBase64Encoded: false,
        },
        makeCtx(),
      ),
    );
    expect(created.statusCode).toBe(201);
    const id = created.json.id;

    // GET
    const res = parse(
      await getUser(
        {
          requestContext: { http: { method: "GET" } },
          rawPath: `/users/${id}`,
          pathParameters: { id },
          headers: {},
        },
        makeCtx(),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ id, name: "Grace" });
  });
});

