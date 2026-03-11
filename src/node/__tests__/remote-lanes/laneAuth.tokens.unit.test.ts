import { generateKeyPairSync } from "node:crypto";
import {
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../../remote-lanes/laneAuth.tokens";

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
      "runner.errors.remoteLanes.auth.unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.claims",
          bindingAuth: { secret: "claim-secret" },
          token,
          requiredCapability: "consume",
        }),
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.verifierMissing",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { mode: "jwt_asymmetric", privateKey: privatePem },
          token: asymToken,
          requiredCapability: "produce",
        }),
      "runner.errors.remoteLanes.auth.verifierMissing",
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
      "runner.errors.remoteLanes.auth.unauthorized",
    );

    expectRunnerErrorId(
      () =>
        verifyRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { secret: "wrong-secret" },
          token: hmacToken,
          requiredCapability: "produce",
        }),
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.unauthorized",
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
      "runner.errors.remoteLanes.auth.unauthorized",
    );

    expectRunnerErrorId(
      () =>
        issueRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: {},
          capability: "produce",
        }),
      "runner.errors.remoteLanes.auth.signerMissing",
    );

    expectRunnerErrorId(
      () =>
        issueRemoteLaneToken({
          laneId: "lane.alg",
          bindingAuth: { mode: "jwt_asymmetric" },
          capability: "produce",
        }),
      "runner.errors.remoteLanes.auth.signerMissing",
    );
  });
});
