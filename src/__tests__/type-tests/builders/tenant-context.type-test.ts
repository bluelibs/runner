import {
  asyncContexts,
  Match,
  type IIdentity,
  type InferMatchPattern,
  type IdentityContextValue,
} from "../../../";
import { identityContextValuePattern } from "../../../async-contexts/identity.asyncContext";

declare module "../../../" {
  interface IdentityContextValue {
    region: string;
  }
}

const baseTenant: IIdentity = { tenantId: "acme" };
const extendedTenant: IdentityContextValue = {
  ...baseTenant,
  region: "eu-west",
};

type TenantPatternValue = InferMatchPattern<typeof identityContextValuePattern>;
const basePatternTenant: TenantPatternValue = {
  tenantId: "acme",
  extra: true,
};
void basePatternTenant;

void (async () => {
  await asyncContexts.identity.provide(extendedTenant, async () => {
    const current = asyncContexts.identity.use();
    const tenantId: string = current.tenantId!;
    const region: string = current.region;

    void tenantId;
    void region;
  });
})();

{
  const candidate: unknown = {
    tenantId: "acme",
    region: "eu-west",
  };

  if (Match.test(candidate, identityContextValuePattern)) {
    const tenantId: string = candidate.tenantId!;
    const region: unknown = candidate.region;

    void tenantId;
    void region;
    // @ts-expect-error pattern inference does not prove app-level augmentation
    const strictRegion: string = candidate.region;
    void strictRegion;
  }
}
