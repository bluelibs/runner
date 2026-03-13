import { generateKeyPairSync } from "node:crypto";
import {
  resolveAsymmetricKid,
  resolveAsymmetricPrivateKey,
  resolveAsymmetricPublicKey,
  resolveBindingMode,
  resolveHmacSecret,
} from "../../remote-lanes/laneAuth.binding";
import {
  getRemoteLaneAuthHeaderName,
  readRemoteLaneTokenFromHeaders,
  writeRemoteLaneTokenToHeaders,
  assertRemoteLaneSignerConfigured,
  assertRemoteLaneVerifierConfigured,
} from "../../remote-lanes/laneAuth.config";
import {
  parseLaneJwt,
  readHeaderValue,
  signLaneJwtWithAsymmetric,
  signLaneJwtWithHmac,
  verifyLaneJwtAsymmetricSignature,
  verifyLaneJwtHmacSignature,
} from "../../remote-lanes/laneAuth.jwt";
import { resolveLaneAuthPolicy } from "../../remote-lanes/laneAuth.policy";
import * as laneAuthApi from "../../remote-lanes/laneAuth";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("laneAuth helpers", () => {
  it("covers binding helpers", () => {
    expect(resolveBindingMode(undefined)).toBeUndefined();
    expect(resolveBindingMode({ secret: "s" })).toBe("jwt_hmac");
    expect(resolveBindingMode({ mode: "none" })).toBe("none");

    expect(resolveHmacSecret(undefined, "produce")).toBeUndefined();
    expect(resolveHmacSecret({ mode: "none" }, "produce")).toBeUndefined();
    expect(
      resolveHmacSecret({ mode: "jwt_asymmetric", publicKey: "pk" }, "consume"),
    ).toBeUndefined();
    expect(resolveHmacSecret({ secret: "s" }, "produce")).toBe("s");
    expect(
      resolveHmacSecret(
        { secret: "s", produceSecret: "sp", consumeSecret: "sc" },
        "produce",
      ),
    ).toBe("sp");
    expect(
      resolveHmacSecret(
        { secret: "s", produceSecret: "sp", consumeSecret: "sc" },
        "consume",
      ),
    ).toBe("sc");

    expect(resolveAsymmetricPrivateKey(undefined)).toBeUndefined();
    expect(resolveAsymmetricPrivateKey({ secret: "s" })).toBeUndefined();
    expect(
      resolveAsymmetricPrivateKey({
        mode: "jwt_asymmetric",
        privateKey: "private",
      }),
    ).toBe("private");
    expect(resolveAsymmetricKid(undefined)).toBeUndefined();
    expect(resolveAsymmetricKid({ secret: "s" })).toBeUndefined();
    expect(
      resolveAsymmetricKid({
        mode: "jwt_asymmetric",
        privateKeyKid: "kid-1",
      }),
    ).toBe("kid-1");

    expect(
      resolveAsymmetricPublicKey({ bindingAuth: undefined }),
    ).toBeUndefined();
    expect(
      resolveAsymmetricPublicKey({ bindingAuth: { secret: "s" } }),
    ).toBeUndefined();
    expect(
      resolveAsymmetricPublicKey({
        bindingAuth: {
          mode: "jwt_asymmetric",
          publicKeysByKid: { k1: "pk1", k2: "pk2" },
        },
        kid: "k2",
      }),
    ).toBe("pk2");
    expect(
      resolveAsymmetricPublicKey({
        bindingAuth: {
          mode: "jwt_asymmetric",
          publicKey: "single",
          publicKeysByKid: { k1: "pk1" },
        },
      }),
    ).toBe("single");
    expect(
      resolveAsymmetricPublicKey({
        bindingAuth: {
          mode: "jwt_asymmetric",
          publicKeysByKid: { k1: "pk1" },
        },
      }),
    ).toBe("pk1");
    expect(
      resolveAsymmetricPublicKey({
        bindingAuth: { mode: "jwt_asymmetric" },
      }),
    ).toBeUndefined();
  });

  it("covers policy resolution and config/header helpers", () => {
    expect(resolveLaneAuthPolicy(undefined).mode).toBe("none");
    expect(resolveLaneAuthPolicy({ mode: "none" }).mode).toBe("none");
    expect(resolveLaneAuthPolicy({}).mode).toBe("jwt_hmac");
    expect(
      resolveLaneAuthPolicy({
        mode: "jwt_asymmetric",
        algorithm: "RS256",
        header: "Authorization",
      }),
    ).toMatchObject({
      mode: "jwt_asymmetric",
      algorithm: "RS256",
      header: "authorization",
    });

    expect(getRemoteLaneAuthHeaderName({ mode: "none" })).toBe("authorization");
    expect(getRemoteLaneAuthHeaderName({ header: "X-Lane-Token" })).toBe(
      "x-lane-token",
    );
    expect(readRemoteLaneTokenFromHeaders({}, {})).toBeUndefined();
    expect(
      readRemoteLaneTokenFromHeaders(
        { "x-lane-token": "abc" },
        { header: "x-lane-token" },
      ),
    ).toBe("abc");
    expect(
      readRemoteLaneTokenFromHeaders({ authorization: "Bearer jwt-value" }, {}),
    ).toBe("jwt-value");
    expect(
      readRemoteLaneTokenFromHeaders({ authorization: " raw-token " }, {}),
    ).toBe("raw-token");

    const headers: Record<string, string> = {};
    writeRemoteLaneTokenToHeaders(headers, {}, "t1");
    expect(headers.authorization).toBe("Bearer t1");
    writeRemoteLaneTokenToHeaders(headers, { header: "x-lane-token" }, "t2");
    expect(headers["x-lane-token"]).toBe("t2");

    expect(() =>
      assertRemoteLaneSignerConfigured("lane", { mode: "none" }),
    ).not.toThrow();
    expect(() =>
      assertRemoteLaneSignerConfigured("lane", { secret: "s" }),
    ).not.toThrow();
    expectRunnerErrorId(
      () => assertRemoteLaneSignerConfigured("lane", {}),
      "remoteLanes-auth-signerMissing",
    );
    expect(() =>
      assertRemoteLaneSignerConfigured("lane", {
        mode: "jwt_asymmetric",
        privateKey: "pk",
      }),
    ).not.toThrow();
    expectRunnerErrorId(
      () =>
        assertRemoteLaneSignerConfigured("lane", { mode: "jwt_asymmetric" }),
      "remoteLanes-auth-signerMissing",
    );

    expect(() =>
      assertRemoteLaneVerifierConfigured("lane", { secret: "s" }),
    ).not.toThrow();
    expectRunnerErrorId(
      () => assertRemoteLaneVerifierConfigured("lane", { produceSecret: "sp" }),
      "remoteLanes-auth-verifierMissing",
    );
    expect(() =>
      assertRemoteLaneVerifierConfigured("lane", {
        mode: "jwt_asymmetric",
        publicKey: "pk",
      }),
    ).not.toThrow();
    expectRunnerErrorId(
      () =>
        assertRemoteLaneVerifierConfigured("lane", {
          mode: "jwt_asymmetric",
          privateKey: "pk",
        }),
      "remoteLanes-auth-verifierMissing",
    );
  });

  it("covers JWT primitives and laneAuth entrypoint exports", () => {
    const hmac = signLaneJwtWithHmac(
      { alg: "HS256", typ: "JWT" },
      { lane: "l", cap: "produce", iat: 1, exp: 2 },
      "secret",
    );
    const parsed = parseLaneJwt(hmac, "l");
    expect(parsed.payload.lane).toBe("l");
    expect(
      verifyLaneJwtHmacSignature({
        encoded: parsed.encoded,
        signature: parsed.signature,
        secret: "secret",
      }),
    ).toBe(true);
    expect(
      verifyLaneJwtHmacSignature({
        encoded: parsed.encoded,
        signature: "AA",
        secret: "secret",
      }),
    ).toBe(false);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const asym = signLaneJwtWithAsymmetric({
      header: { alg: "EdDSA", typ: "JWT", kid: "k1" },
      payload: { lane: "l2", cap: "produce", iat: 10, exp: 20 },
      privateKey: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      algorithm: "EdDSA",
    });
    const asymParsed = parseLaneJwt(asym, "l2");
    expect(
      verifyLaneJwtAsymmetricSignature({
        encoded: asymParsed.encoded,
        signature: asymParsed.signature,
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
        algorithm: "EdDSA",
      }),
    ).toBe(true);
    expect(
      verifyLaneJwtAsymmetricSignature({
        encoded: asymParsed.encoded,
        signature: asymParsed.signature,
        publicKey: "not-a-key",
        algorithm: "EdDSA",
      }),
    ).toBe(false);

    const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } =
      generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaJwt = signLaneJwtWithAsymmetric({
      header: { alg: "RS256", typ: "JWT", kid: "k-rsa" },
      payload: { lane: "l3", cap: "consume", iat: 11, exp: 22 },
      privateKey: rsaPrivateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      algorithm: "RS256",
    });
    const rsaParsed = parseLaneJwt(rsaJwt, "l3");
    expect(
      verifyLaneJwtAsymmetricSignature({
        encoded: rsaParsed.encoded,
        signature: rsaParsed.signature,
        publicKey: rsaPublicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
        algorithm: "RS256",
      }),
    ).toBe(true);

    expectRunnerErrorId(
      () => parseLaneJwt("a.b", "l"),
      "remoteLanes-auth-unauthorized",
    );
    const invalidPayload = signLaneJwtWithHmac(
      { alg: "HS256", typ: "JWT" },
      { lane: "l", cap: "produce", iat: 1 } as any,
      "secret",
    );
    expectRunnerErrorId(
      () => parseLaneJwt(invalidPayload, "l"),
      "remoteLanes-auth-unauthorized",
    );
    expectRunnerErrorId(
      () => parseLaneJwt("abc.def.ghi", "l"),
      "remoteLanes-auth-unauthorized",
    );

    expect(readHeaderValue(undefined)).toBe("");
    expect(readHeaderValue(["x"])).toBe("x");
    expect(readHeaderValue([])).toBe("");

    expect(typeof laneAuthApi.issueRemoteLaneToken).toBe("function");
    expect(typeof laneAuthApi.verifyRemoteLaneToken).toBe("function");
    expect(typeof laneAuthApi.resolveLaneAuthPolicy).toBe("function");
    expect(typeof laneAuthApi.getRemoteLaneAuthHeaderName).toBe("function");
    expect(typeof laneAuthApi.assertRemoteLaneSignerConfigured).toBe(
      "function",
    );
  });
});
