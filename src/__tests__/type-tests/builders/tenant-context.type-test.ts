import {
  asyncContexts,
  Match,
  type ITenant,
  type InferMatchPattern,
  type TenantContextValue,
} from "../../../";
import { tenantContextValuePattern } from "../../../async-contexts/tenant.asyncContext";

declare module "../../../" {
  interface TenantContextValue {
    region: string;
  }
}

const baseTenant: ITenant = { tenantId: "acme" };
const extendedTenant: TenantContextValue = {
  ...baseTenant,
  region: "eu-west",
};

type TenantPatternValue = InferMatchPattern<typeof tenantContextValuePattern>;
const basePatternTenant: TenantPatternValue = {
  tenantId: "acme",
  extra: true,
};
void basePatternTenant;

void (async () => {
  await asyncContexts.tenant.provide(extendedTenant, async () => {
    const current = asyncContexts.tenant.use();
    const tenantId: string = current.tenantId;
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

  if (Match.test(candidate, tenantContextValuePattern)) {
    const tenantId: string = candidate.tenantId;
    const region: unknown = candidate.region;

    void tenantId;
    void region;
    // @ts-expect-error pattern inference does not prove app-level augmentation
    const strictRegion: string = candidate.region;
    void strictRegion;
  }
}
