import { run } from "@bluelibs/runner";
import request from "supertest";
import { app } from "../index";

describe("Express OpenAPI SQLite Integration", () => {
  let appInstance: any;
  let dispose: any;
  let server: any;

  beforeAll(async () => {
    // Start the application
    const result = await run(app);
    appInstance = result.value;
    dispose = result.dispose;
    server = appInstance.server.app;
  });

  afterAll(async () => {
    // Clean up
    if (dispose) {
      await dispose();
    }
  });

  describe("Health Check", () => {
    it("should return health status", async () => {
      const response = await request(server)
        .get("/health")
        .expect(200);

      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("timestamp");
    });
  });

  describe("User Registration and Authentication Flow", () => {
    const testUser = {
      email: "test@example.com",
      password: "password123",
      name: "Test User"
    };

    let authToken: string;

    it("should register a new user", async () => {
      const response = await request(server)
        .post("/api/auth/register")
        .send(testUser)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("token");
      expect(response.body.data.user).toMatchObject({
        email: testUser.email,
        name: testUser.name
      });
      expect(response.body.data.user).toHaveProperty("id");
      expect(response.body.data.user).not.toHaveProperty("passwordHash");

      authToken = response.body.data.token;
    });

    it("should not register user with duplicate email", async () => {
      const response = await request(server)
        .post("/api/auth/register")
        .send(testUser)
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("already exists");
    });

    it("should login with valid credentials", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("token");
      expect(response.body.data.user).toMatchObject({
        email: testUser.email,
        name: testUser.name
      });
    });

    it("should not login with invalid credentials", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: testUser.email,
          password: "wrongpassword"
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
        email: testUser.email,
        name: testUser.name
      });
    });

    it("should not get profile without token", async () => {
      const response = await request(server)
        .get("/api/auth/profile")
        .expect(500); // Our middleware throws an error

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Authentication required");
    });

    it("should not get profile with invalid token", async () => {
      const response = await request(server)
        .get("/api/auth/profile")
        .set("Authorization", "Bearer invalid-token")
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid or expired token");
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
          name: "A" // too short
        })
        .expect(500); // Validation error

      expect(response.body.success).toBe(false);
    });

    it("should validate login input", async () => {
      const response = await request(server)
        .post("/api/auth/login")
        .send({
          email: "invalid-email",
          password: ""
        })
        .expect(500); // Validation error

      expect(response.body.success).toBe(false);
    });
  });

  describe("API Documentation", () => {
    it("should serve Swagger documentation", async () => {
      const response = await request(server)
        .get("/api-docs/")
        .expect(200);

      expect(response.text).toContain("swagger");
    });
  });
});