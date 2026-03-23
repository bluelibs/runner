import { generateKeyPairSync } from "node:crypto";
import {
  createRemoteLaneReplayProtector,
  hashRemoteLanePayload,
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../../remote-lanes/laneAuth";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("laneAuth token flow", () => {
  it("issues and verifies HMAC tokens", () => {
    const token = issueRemoteLaneToken({
      laneId: "lane.hmac",
      bindingAuth: { secret: "hmac-secret" },
      capability: "produce",
      nowMs: 1_000,
    });
    expect(token).toBeTruthy();

    expect(() =>
      verifyRemoteLaneToken({
        laneId: "lane.hmac",
        bindingAuth: { secret: "hmac-secret" },
        token: token!,
        requiredCapability: "produce",
        nowMs: 1_500,
      }),
    ).not.toThrow();
  });

  it("binds tokens to their target and payload hash", () => {
    const payloadText = JSON.stringify({ input: { value: 1 } });
    const token = issueRemoteLaneToken({
      laneId: "lane.bound",
      bindingAuth: { secret: "bound-secret" },
      capability: "produce",
      target: {
        kind: "rpc-task",
        targetId: "task.bound",
        payloadHash: hashRemoteLanePayload(payloadText),
      },
    })!;

    expect(() =>
      verifyRemoteLaneToken({
        laneId: "lane.bound",
        bindingAuth: { secret: "bound-secret" },
        token,
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-task",
          targetId: "task.bound",
          payloadHash: hashRemoteLanePayload(payloadText),
        },
      }),
    ).not.toThrow();

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.bound",
          bindingAuth: { secret: "bound-secret" },
          token,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-event",
            targetId: "task.bound",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.bound",
          bindingAuth: { secret: "bound-secret" },
          token,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-task",
            targetId: "task.other",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.bound",
          bindingAuth: { secret: "bound-secret" },
          token,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-task",
            targetId: "task.bound",
            payloadHash: hashRemoteLanePayload(
              JSON.stringify({ input: { value: 2 } }),
            ),
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    const unboundToken = issueRemoteLaneToken({
      laneId: "lane.bound",
      bindingAuth: { secret: "bound-secret" },
      capability: "produce",
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.bound",
          bindingAuth: { secret: "bound-secret" },
          token: unboundToken,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-task",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.bound",
          bindingAuth: { secret: "bound-secret" },
          token: unboundToken,
          requiredCapability: "produce",
          expectedTarget: {
            targetId: "task.bound",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("reports unknown target claims when a lane-only token is verified as bound", () => {
    const token = issueRemoteLaneToken({
      laneId: "lane.unbound",
      bindingAuth: { secret: "unbound-secret" },
      capability: "produce",
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.unbound",
          bindingAuth: { secret: "unbound-secret" },
          token,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-task",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.unbound",
          bindingAuth: { secret: "unbound-secret" },
          token,
          requiredCapability: "produce",
          expectedTarget: {
            targetId: "task.missing",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("rejects replayed tokens when replay protection is enabled", () => {
    const replayProtector = createRemoteLaneReplayProtector();
    const token = issueRemoteLaneToken({
      laneId: "lane.replay",
      bindingAuth: { secret: "replay-secret" },
      capability: "produce",
    })!;

    expect(() =>
      verifyRemoteLaneToken({
        laneId: "lane.replay",
        bindingAuth: { secret: "replay-secret" },
        token,
        requiredCapability: "produce",
        replayProtector,
      }),
    ).not.toThrow();

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.replay",
          bindingAuth: { secret: "replay-secret" },
          token,
          requiredCapability: "produce",
          replayProtector,
        }),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("rejects lane-only tokens when target claims are required", () => {
    const kindOnlyToken = issueRemoteLaneToken({
      laneId: "lane.legacy-targets",
      bindingAuth: { secret: "legacy-secret" },
      capability: "produce",
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.legacy-targets",
          bindingAuth: { secret: "legacy-secret" },
          token: kindOnlyToken,
          requiredCapability: "produce",
          expectedTarget: {
            kind: "rpc-task",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );

    const missingTargetIdToken = issueRemoteLaneToken({
      laneId: "lane.legacy-targets",
      bindingAuth: { secret: "legacy-secret" },
      capability: "produce",
      target: {
        kind: "rpc-task",
        targetId: undefined as any,
      },
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.legacy-targets",
          bindingAuth: { secret: "legacy-secret" },
          token: missingTargetIdToken,
          requiredCapability: "produce",
          expectedTarget: {
            targetId: "task.required",
          },
        }),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("returns undefined for mode none and no-ops verification", () => {
    const token = issueRemoteLaneToken({
      laneId: "lane.none",
      bindingAuth: { mode: "none" },
      capability: "produce",
    });
    expect(token).toBeUndefined();

    expect(() =>
      verifyRemoteLaneToken({
        laneId: "lane.none",
        bindingAuth: { mode: "none" },
        token: "ignored",
        requiredCapability: "produce",
      }),
    ).not.toThrow();
  });

  it("enforces failure branches for invalid/mismatched HMAC token claims", () => {
    const token = issueRemoteLaneToken({
      laneId: "lane.claims",
      bindingAuth: { secret: "claim-secret" },
      capability: "produce",
      nowMs: 5_000,
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "other.lane",
          bindingAuth: { secret: "claim-secret" },
          token,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.claims",
          bindingAuth: { secret: "claim-secret" },
          token,
          requiredCapability: "consume",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.claims",
          bindingAuth: { secret: "claim-secret" },
          token,
          requiredCapability: "produce",
          nowMs: 100_000,
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.claims",
          bindingAuth: { secret: "claim-secret" },
          token,
          requiredCapability: "produce",
          nowMs: -31_000,
        }),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("enforces algorithm and secret/key validation branches", () => {
    const hmacToken = issueRemoteLaneToken({
      laneId: "lane.alg",
      bindingAuth: { secret: "alg-secret" },
      capability: "produce",
    })!;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const publicPem = publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const asymToken = issueRemoteLaneToken({
      laneId: "lane.alg",
      bindingAuth: {
        mode: "jwt_asymmetric",
        privateKey: privatePem,
      },
      capability: "produce",
    })!;

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { produceSecret: "only-produce" },
          token: hmacToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-verifierMissing",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { mode: "jwt_asymmetric", privateKey: privatePem },
          token: asymToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-verifierMissing",
    );
    expect(() =>
      verifyRemoteLaneToken({
        laneId: "lane.alg",
        bindingAuth: {
          mode: "jwt_asymmetric",
          publicKey: publicPem,
          algorithm: "EdDSA",
        },
        token: asymToken,
        requiredCapability: "produce",
      }),
    ).not.toThrow();

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { secret: "alg-secret" },
          token: asymToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { secret: "wrong-secret" },
          token: hmacToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    const otherPublicPem = generateKeyPairSync("ed25519")
      .publicKey.export({ format: "pem", type: "spki" })
      .toString();
    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: {
            mode: "jwt_asymmetric",
            publicKey: otherPublicPem,
            algorithm: "EdDSA",
          },
          token: asymToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: {
            mode: "jwt_asymmetric",
            publicKey: publicPem,
            algorithm: "EdDSA",
          },
          token: hmacToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: {
            mode: "jwt_asymmetric",
            publicKey: publicPem,
            algorithm: "RS256",
          },
          token: asymToken,
          requiredCapability: "produce",
        }),
      "remoteLanes-auth-unauthorized",
    );

    expectRunnerErrorId(
      () =>
        issueRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: {},
          capability: "produce",
        }),
      "remoteLanes-auth-signerMissing",
    );

    expectRunnerErrorId(
      () =>
        issueRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { mode: "jwt_asymmetric" },
          capability: "produce",
        }),
      "remoteLanes-auth-signerMissing",
    );
  });
});
