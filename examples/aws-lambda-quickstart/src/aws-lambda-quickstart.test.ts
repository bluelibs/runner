import { createUser as createUserTask, disposeRunner, getRunner } from "./bootstrap";
import { handler as lambdalith } from "./handler.lambdalith";
import { handler as getUser } from "./handlers/getUser";
import { handler as createUserHandler } from "./handlers/createUser";
import { APIGatewayProxyResult } from "./http";

function makeCtx() {
  return { awsRequestId: `req-${Math.random().toString(36).slice(2)}` };
}

function parse<T>(res: APIGatewayProxyResult) {
  return { ...res, json: JSON.parse(res.body || "null") };
}

describe("examples/aws-lambda-quickstart", () => {
  afterEach(async () => {
    await disposeRunner();
  });

  it("lambdalith flow: POST /users then GET /users/{id}", async () => {
    // GET first should 404
    const res404 = parse<{ message: string }>(
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
    const created = parse<{ id: string; name: string }>(
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
    const res200 = parse<{ id: string; name: string }>(
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
    const created = parse<{ id: string; name: string }>(
      await createUserHandler(
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
    const res = parse<{ id: string; name: string }>(
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

  it("lambdalith: OPTIONS preflight responds 204 with CORS headers", async () => {
    const res = await lambdalith(
      {
        requestContext: { http: { method: "OPTIONS" } },
        rawPath: "/users",
        headers: {},
      },
      makeCtx(),
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("validation: createUser returns 400 when name missing", async () => {
    const res = parse<{ message: string }>(
      await createUserHandler(
        {
          requestContext: { http: { method: "POST" } },
          rawPath: "/users",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
          isBase64Encoded: false,
        },
        makeCtx(),
      ),
    );
    expect(res.statusCode).toBe(400);
  });

  it("base64 body parsing works", async () => {
    const payload = Buffer.from(
      JSON.stringify({ name: "B64" }),
      "utf8",
    ).toString("base64");
    const created = parse<{ id: string; name: string }>(
      await createUserHandler(
        {
          requestContext: { http: { method: "POST" } },
          rawPath: "/users",
          headers: { "content-type": "application/json" },
          body: payload,
          isBase64Encoded: true,
        },
        makeCtx(),
      ),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({ id: expect.any(String), name: "B64" });
  });

  it("API Gateway v1 compatibility (httpMethod/path)", async () => {
    const created = parse<{ id: string; name: string }>(
      await lambdalith(
        {
          httpMethod: "POST",
          path: "/users",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "v1" }),
          isBase64Encoded: false,
        },
        makeCtx(),
      ),
    );
    expect(created.statusCode).toBe(201);

    const id = created.json.id;
    const res = parse<{ id: string; name: string }>(
      await lambdalith(
        {
          httpMethod: "GET",
          path: `/users/${id}`,
          headers: {},
        },
        makeCtx(),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("reuses the runtime across warm invocations", async () => {
    const first = await getRunner();
    const second = await getRunner();

    expect(first).toBe(second);
  });

  it("fails fast when request context is missing", async () => {
    const runtime = await getRunner();

    await expect(
      runtime.runTask(createUserTask, { name: "no-context" }),
    ).rejects.toThrow();
  });
});
