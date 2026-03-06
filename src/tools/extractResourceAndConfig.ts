import { IResource, IResourceWithConfig } from "../defs";
import { isResourceWithConfig } from "../define";

/**
 * Separates a resource-or-resource-with-config union into the
 * bare resource definition and its config (if any).
 */
export function extractResourceAndConfig<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any>
    | IResource<{ [K in any]?: any }, V, any, any>,
): { resource: IResource<C, V, any, any>; config: C | undefined } {
  if (isResourceWithConfig(resourceOrResourceWithConfig)) {
    return {
      resource: resourceOrResourceWithConfig.resource as IResource<
        C,
        V,
        any,
        any
      >,
      config: resourceOrResourceWithConfig.config as C,
    };
  }

  return {
    resource: resourceOrResourceWithConfig as IResource<C, V, any, any>,
    config: undefined,
  };
}
