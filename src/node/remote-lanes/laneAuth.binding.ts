import type {
  RemoteLaneAuthMode,
  RemoteLaneBindingAuth,
  RemoteLaneBindingAuthJwtAsymmetric,
  RemoteLaneBindingAuthJwtHmac,
} from "../../defs";

export function resolveBindingMode(
  auth: RemoteLaneBindingAuth | undefined,
): RemoteLaneAuthMode | undefined {
  if (!auth) {
    return undefined;
  }
  return auth.mode ?? "jwt_hmac";
}

function isHmacBindingAuth(
  auth: RemoteLaneBindingAuth | undefined,
): auth is RemoteLaneBindingAuthJwtHmac {
  return resolveBindingMode(auth) === "jwt_hmac";
}

function isAsymmetricBindingAuth(
  auth: RemoteLaneBindingAuth | undefined,
): auth is RemoteLaneBindingAuthJwtAsymmetric {
  return resolveBindingMode(auth) === "jwt_asymmetric";
}

export function resolveHmacSecret(
  bindingAuth: RemoteLaneBindingAuth | undefined,
  direction: "produce" | "consume",
): string | undefined {
  if (!isHmacBindingAuth(bindingAuth)) {
    return undefined;
  }

  if (direction === "produce") {
    return bindingAuth.produceSecret ?? bindingAuth.secret;
  }
  return bindingAuth.consumeSecret ?? bindingAuth.secret;
}

export function resolveAsymmetricPrivateKey(
  bindingAuth: RemoteLaneBindingAuth | undefined,
): string | undefined {
  if (!isAsymmetricBindingAuth(bindingAuth)) {
    return undefined;
  }
  return bindingAuth.privateKey;
}

export function resolveAsymmetricKid(
  bindingAuth: RemoteLaneBindingAuth | undefined,
): string | undefined {
  if (!isAsymmetricBindingAuth(bindingAuth)) {
    return undefined;
  }
  return bindingAuth.privateKeyKid;
}

export function resolveAsymmetricPublicKey(options: {
  bindingAuth: RemoteLaneBindingAuth | undefined;
  kid?: string;
}): string | undefined {
  const { bindingAuth, kid } = options;
  if (!isAsymmetricBindingAuth(bindingAuth)) {
    return undefined;
  }

  if (kid && bindingAuth.publicKeysByKid?.[kid]) {
    return bindingAuth.publicKeysByKid[kid];
  }

  if (bindingAuth.publicKey) {
    return bindingAuth.publicKey;
  }

  if (!bindingAuth.publicKeysByKid) {
    return undefined;
  }
  const [first] = Object.values(bindingAuth.publicKeysByKid);
  return first;
}
