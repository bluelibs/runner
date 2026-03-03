import { Match } from "../../tools/check";

const remoteLanesModes = ["network", "transparent", "local-simulated"] as const;

const remoteLaneAuthModes = ["EdDSA", "ES256", "RS256"] as const;

const remoteLaneBindingAuthNonePattern = Match.ObjectIncluding({
  mode: "none",
});

const remoteLaneBindingAuthJwtHmacPattern = Match.ObjectIncluding({
  mode: Match.Optional("jwt_hmac"),
  header: Match.Optional(String),
  tokenTtlMs: Match.Optional(Number),
  clockSkewMs: Match.Optional(Number),
  secret: Match.Optional(String),
  produceSecret: Match.Optional(String),
  consumeSecret: Match.Optional(String),
});

const remoteLaneBindingAuthJwtAsymmetricPattern = Match.ObjectIncluding({
  mode: "jwt_asymmetric",
  header: Match.Optional(String),
  algorithm: Match.Optional(Match.OneOf(...remoteLaneAuthModes)),
  tokenTtlMs: Match.Optional(Number),
  clockSkewMs: Match.Optional(Number),
  privateKey: Match.Optional(String),
  privateKeyKid: Match.Optional(String),
  publicKey: Match.Optional(String),
  publicKeysByKid: Match.Optional(Match.MapOf(String)),
});

export const remoteLanesModePattern = Match.OneOf(...remoteLanesModes);

export const remoteLaneBindingAuthPattern = Match.OneOf(
  remoteLaneBindingAuthNonePattern,
  remoteLaneBindingAuthJwtHmacPattern,
  remoteLaneBindingAuthJwtAsymmetricPattern,
);
