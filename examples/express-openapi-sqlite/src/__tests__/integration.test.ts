import { resource, run } from "@bluelibs/runner";
import request from "supertest";
import { app } from "../index";
import { db } from "../app/db/resources/database";
import { expressServerResource } from "../app/http/resources/express.resource";

describe("Express OpenAPI SQLite Integration", () => {
  let appInstance: any;
  let dispose: any;
  let server: any;

  // Test user data - email will be randomized for each test
  const testUser = {
    email: "test@example.com",
    password: "password123",
    name: "Test User",
  };

  beforeAll(async () => {
    // Start the application
    const testApp = resource({
      id: "tests.harness.express",
      register: [app],
      overrides: [
        db.with({
          filename: ":memory:",
          verbose: true,
        }),
      ],
    });

    const rr = await run(testApp);
    appInstance = rr.value;
    dispose = rr.dispose;
    server = rr.getResourceValue(expressServerResource).app;
  });

  afterAll(async () => {
    // Clean up
    if (dispose) {
      await dispose();
    }
  });

  beforeEach(() => {
    // Use unique email for each test run to avoid conflicts
    testUser.email = `test-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}@example.com`;
  });

  describe("Health Check", () => {
    it("should return health status", async () => {
      const response = await request(server).get("/health").expect(200);

      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("timestamp");
    });
  });

  describe("User Registration and Authentication Flow", () => {
    let authToken: string;
    const uniqueEmail = `test-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}@example.com`;

    it("should register a new user", async () => {
      const userData = {
        email: uniqueEmail,
        password: testUser.password,
        name: testUser.name,
      };

      const response = await request(server)
        .post("/api/auth/register")
        .send(userData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("token");
      expect(response.body.data.user).toMatchObject({
        email: uniqueEmail,
        name: testUser.name,
      });
      expect(response.body.data.user).toHaveProperty("id");
      expect(response.body.data.user).not.toHaveProperty("passwordHash");

      authToken = response.body.data.token;
    });

    it("should not register user with duplicate email", async () => {
      const userData = {
        email: uniqueEmail, // Same email as above
        password: testUser.password,
        name: testUser.name,
      };

      const response = await request(server)
        .post("/api/auth/register")
        .send(userData)
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("already exists");
    });

    it("should login with valid credentials", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: uniqueEmail,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("token");
      expect(response.body.data.user).toMatchObject({
        email: uniqueEmail,
        name: testUser.name,
      });
    });

    it("should not login with invalid credentials", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: uniqueEmail,
          password: "wrongpassword",
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid email or password");
    });

    it("should get user profile with valid token", async () => {
      const response = await request(server)
        .get("/api/auth/profile")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        email: uniqueEmail,
        name: testUser.name,
      });
    });

    it("should not get profile without token", async () => {
      const response = await request(server)
        .get("/api/auth/profile")
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(
        /Authentication required|Authentication/,
      );
    });

    it("should not get profile with invalid token", async () => {
      const response = await request(server)
        .get("/api/auth/profile")
        .set("Authorization", "Bearer invalid-token")
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/Invalid|expired|token/);
    });

    it("should get all users with valid token", async () => {
      const response = await request(server)
        .get("/api/users")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty("email");
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).not.toHaveProperty("passwordHash");
    });
  });

  describe("Input Validation", () => {
    it("should validate registration input", async () => {
      const response = await request(server)
        .post("/api/auth/register")
        .send({
          email: "invalid-email",
          password: "123", // too short
          name: "A", // too short
        })
        .expect(200);

      expect(response.body.success).toBe(false);
    });

    it("should validate login input", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: "invalid-email",
          password: "",
        })
        .expect(200);

      expect(response.body.success).toBe(false);
    });
  });

  describe("API Documentation", () => {
    it("should serve Swagger documentation", async () => {
      const response = await request(server).get("/api-docs/").expect(200);

      expect(response.text).toContain("swagger");
    });
  });
});
