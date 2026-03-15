import { createAuthenticator } from "../../../exposure/authenticator";
import { TaskRunner } from "../../../../models/TaskRunner";
import { Store } from "../../../../models/Store";
import { ITask } from "../../../../defs";
import { IncomingMessage } from "http";
import {
  AuthValidatorInput,
  AuthValidatorResult,
} from "../../../exposure/types";
import { RPC_LANES_RESOURCE_ID } from "../../../rpc-lanes/rpcLanes.resource";

const mockTaskRunner = {
  run: jest.fn(),
} as unknown as jest.Mocked<TaskRunner>;
const mockStore = {
  hasDefinition: jest.fn(() => false),
  findIdByDefinition: jest.fn((reference: unknown) => String(reference)),
} as unknown as jest.Mocked<
  Pick<Store, "findIdByDefinition" | "hasDefinition">
>;
const authenticatorStore = mockStore as unknown as Store;
type AuthValidatorTask = ITask<
  AuthValidatorInput,
  Promise<AuthValidatorResult>,
  any
>;

describe("node exposure - authenticator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.hasDefinition.mockReturnValue(false);
    mockStore.findIdByDefinition.mockImplementation((reference: unknown) =>
      String(reference),
    );
  });

  describe("createAuthenticator", () => {
    it("returns AUTH_NOT_CONFIGURED when token is not set and no validators (fail-closed)", async () => {
      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(500);
        expect(
          (result.response.body as unknown as { error: { code: string } }).error
            .code,
        ).toBe("AUTH_NOT_CONFIGURED");
      }
    });

    it("returns passthrough when allowAnonymous is explicitly true", async () => {
      const auth = createAuthenticator(
        { allowAnonymous: true },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result).toEqual({ ok: true });
    });

    it("accepts provided token using custom header and array values", async () => {
      const auth = createAuthenticator(
        { header: "X-Custom", token: "secret" },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const ok = await auth({
        headers: { "x-custom": ["secret"] },
      } as unknown as IncomingMessage);
      expect(ok).toEqual({ ok: true });
    });

    it("accepts provided token from default header string", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const ok = await auth({
        headers: { "x-runner-token": "expected" },
      } as unknown as IncomingMessage);
      expect(ok).toEqual({ ok: true });
    });

    it("rejects when token mismatches", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    });

    it("falls back to empty string when header array has no first value", async () => {
      const auth = createAuthenticator(
        { token: "expected" },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const result = await auth({
        headers: { "x-runner-token": [] },
      } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
    });

    it("supports array of tokens", async () => {
      const auth = createAuthenticator(
        { token: ["token1", "token2"] },
        authenticatorStore,
        mockTaskRunner,
        [],
      );
      const ok1 = await auth({
        headers: { "x-runner-token": "token1" },
      } as unknown as IncomingMessage);
      expect(ok1).toEqual({ ok: true });
      const ok2 = await auth({
        headers: { "x-runner-token": "token2" },
      } as unknown as IncomingMessage);
      expect(ok2).toEqual({ ok: true });
      const fail = await auth({
        headers: { "x-runner-token": "wrong" },
      } as unknown as IncomingMessage);
      expect(fail.ok).toBe(false);
    });

    it("runs validator tasks when token check fails", async () => {
      const task = { id: "v1" } as unknown as AuthValidatorTask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));
      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [task],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(mockTaskRunner.run).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ url: "/", method: "GET" }),
        expect.objectContaining({
          source: {
            kind: "resource",
            id: RPC_LANES_RESOURCE_ID,
          },
        }),
      );
      expect(result).toEqual({ ok: true });
    });

    it("tries next validator if first fails", async () => {
      const t1 = { id: "v1" } as unknown as AuthValidatorTask;
      const t2 = { id: "v2" } as unknown as AuthValidatorTask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: false }));
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));
      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [t1, t2],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result).toEqual({ ok: true });
      expect(mockTaskRunner.run).toHaveBeenCalledTimes(2);
    });

    it("treats validator exceptions as failures and continues", async () => {
      const t1 = { id: "v1" } as unknown as AuthValidatorTask;
      const t2 = { id: "v2" } as unknown as AuthValidatorTask;
      mockTaskRunner.run.mockRejectedValueOnce(new Error("oops"));
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));
      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [t1, t2],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result).toEqual({ ok: true });
    });

    it("fails if all validators fail", async () => {
      const t1 = { id: "v1" } as unknown as AuthValidatorTask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: false }));
      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [t1],
      );
      const result = await auth({ headers: {} } as unknown as IncomingMessage);
      expect(result.ok).toBe(false);
    });

    it("canonicalizes the exposure source resource id when the store knows it", async () => {
      const task = { id: "v1" } as unknown as AuthValidatorTask;
      mockStore.hasDefinition.mockImplementation(
        (reference: unknown) => reference === "exposure",
      );
      mockStore.findIdByDefinition.mockImplementation((reference: unknown) =>
        reference === "exposure" ? "app.resources.exposure" : String(reference),
      );
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));

      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [task],
        "exposure",
      );
      await auth({ headers: {} } as unknown as IncomingMessage);

      expect(mockTaskRunner.run).toHaveBeenCalledWith(
        task,
        expect.anything(),
        expect.objectContaining({
          source: {
            kind: "resource",
            id: "app.resources.exposure",
          },
        }),
      );
    });

    it("falls back to the provided source resource id when canonical resolution returns null", async () => {
      const task = { id: "v1" } as unknown as AuthValidatorTask;
      mockTaskRunner.run.mockResolvedValueOnce(Promise.resolve({ ok: true }));

      const auth = createAuthenticator(
        undefined,
        authenticatorStore,
        mockTaskRunner,
        [task],
        "",
      );
      await auth({ headers: {} } as unknown as IncomingMessage);

      expect(mockTaskRunner.run).toHaveBeenCalledWith(
        task,
        expect.anything(),
        expect.objectContaining({
          source: {
            kind: "resource",
            id: "",
          },
        }),
      );
    });
  });
});
