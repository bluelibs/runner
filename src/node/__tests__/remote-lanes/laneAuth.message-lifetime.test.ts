import {
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import { check } from "../../../tools/check";
import { remoteLaneBindingAuthPattern } from "../../remote-lanes/configPatterns";
import { generateKeyPairSync } from "node:crypto";

describe("queued lane token lifetime", () => {
  const issuedAt = 1_700_000_000_000;
  const target = {
    kind: "event-lane",
    targetId: "app.events.sent",
    payloadHash: "payload-hash",
  } as const;

  it("uses the queued lifetime for asymmetric signatures too", () => {
    const keys = generateKeyPairSync("ed25519");
    const auth = {
      mode: "jwt_asymmetric",
      privateKey: keys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicKey: keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      clockSkewMs: 0,
    } as const;
    const token = issueRemoteLaneToken({
      laneId: "mail",
      bindingAuth: auth,
      capability: "produce",
      target,
      nowMs: issuedAt,
    })!;
    expect(() =>
      verifyRemoteLaneToken({
        laneId: "mail",
        bindingAuth: auth,
        token,
        requiredCapability: "produce",
        expectedTarget: target,
        nowMs: issuedAt + 3_600_000,
      }),
    ).not.toThrow();
  });

  it("survives a backlog and still rejects messages past the validity window", () => {
    const auth = { secret: "tests", clockSkewMs: 0 };
    const token = issueRemoteLaneToken({
      laneId: "mail",
      bindingAuth: auth,
      capability: "produce",
      target,
      nowMs: issuedAt,
    })!;
    const verify = (age: number) =>
      verifyRemoteLaneToken({
        laneId: "mail",
        bindingAuth: auth,
        token,
        requiredCapability: "produce",
        expectedTarget: target,
        nowMs: issuedAt + age,
      });
    expect(() => verify(3_600_000)).not.toThrow();
    expect(() => verify(86_401_000)).toThrow("token expired");
    expect(() =>
      verifyRemoteLaneToken({
        laneId: "mail",
        bindingAuth: auth,
        token,
        requiredCapability: "produce",
        expectedTarget: { ...target, payloadHash: "modified" },
        nowMs: issuedAt + 3_600_000,
      }),
    ).toThrow("payload hash mismatch");
  });

  it("keeps explicit legacy lifetimes and lets messageTtlMs override them", () => {
    const token = (messageTtlMs?: number) =>
      issueRemoteLaneToken({
        laneId: "mail",
        bindingAuth: { secret: "tests", tokenTtlMs: 1000, messageTtlMs },
        capability: "produce",
        target,
        nowMs: issuedAt,
      })!;
    const verify = (value: string) =>
      verifyRemoteLaneToken({
        laneId: "mail",
        bindingAuth: { secret: "tests", clockSkewMs: 0 },
        token: value,
        requiredCapability: "produce",
        nowMs: issuedAt + 2000,
      });
    expect(() => verify(token())).toThrow("token expired");
    expect(() => verify(token(60_000))).not.toThrow();
  });

  it("keeps RPC authentication short even with a queued message lifetime configured", () => {
    const auth = { secret: "tests", messageTtlMs: 86_400_000, clockSkewMs: 0 };
    const token = issueRemoteLaneToken({
      laneId: "mail",
      bindingAuth: auth,
      capability: "produce",
      target: { ...target, kind: "rpc-task" },
      nowMs: issuedAt,
    })!;
    expect(() =>
      verifyRemoteLaneToken({
        laneId: "mail",
        bindingAuth: auth,
        token,
        requiredCapability: "produce",
        nowMs: issuedAt + 61_000,
      }),
    ).toThrow("token expired");
  });

  it.each([0, -1, 0.5, Infinity, NaN, "one hour"])(
    "rejects invalid messageTtlMs %s at the config boundary",
    (messageTtlMs) => {
      expect(() =>
        check({ secret: "tests", messageTtlMs }, remoteLaneBindingAuthPattern),
      ).toThrow();
    },
  );
});
