import { handler as lambdalith } from "./handler.lambdalith";
import { handler as getUser } from "./handlers/getUser";
import { handler as createUser } from "./handlers/createUser";

// Demo test run

async function runLambdalith() {
  const ctx = { awsRequestId: "local-lith-1" };

  // Try GET before any user exists
  const notFound = await lambdalith(
    {
      requestContext: { http: { method: "GET" } },
      rawPath: "/users/1",
      headers: {},
    },
    ctx,
  );
  console.log("LITH GET /users/1 =>", notFound.statusCode, notFound.body);

  // Create user
  const created = await lambdalith(
    {
      requestContext: { http: { method: "POST" } },
      rawPath: "/users",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
      isBase64Encoded: false,
    },
    ctx,
  );
  console.log("LITH POST /users =>", created.statusCode, created.body);

  const id = JSON.parse(created.body).id;

  // Fetch created user
  const fetched = await lambdalith(
    {
      requestContext: { http: { method: "GET" } },
      rawPath: `/users/${id}`,
      headers: {},
    },
    ctx,
  );
  console.log(`LITH GET /users/${id} =>`, fetched.statusCode, fetched.body);
}

async function runPerRoute() {
  const ctx = { awsRequestId: "local-perroute-1" };

  // Create user via dedicated handler
  const created = await createUser(
    {
      requestContext: { http: { method: "POST" } },
      rawPath: "/users",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Grace" }),
      isBase64Encoded: false,
    },
    ctx,
  );
  console.log("PR POST /users =>", created.statusCode, created.body);
  const id = JSON.parse(created.body).id;

  // Fetch created user via dedicated handler
  const ok = await getUser(
    {
      requestContext: { http: { method: "GET" } },
      rawPath: `/users/${id}`,
      pathParameters: { id },
      headers: {},
    },
    ctx,
  );
  console.log(`PR GET /users/${id} =>`, ok.statusCode, ok.body);
}

async function main() {
  console.log("— Lambdalith demo —");
  await runLambdalith();
  console.log("— Per-route demo —");
  await runPerRoute();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
