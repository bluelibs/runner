import { IHook } from "../../defs";
import * as utils from "../../define";
import type { StoreRegistry } from "../store/StoreRegistry";
import type { SupportedOverride } from "./overrideDefinition";

export function storeDefinitionOverride(
  registry: StoreRegistry,
  targetId: string,
  override: SupportedOverride,
): void {
  if (utils.isTask(override)) {
    registry.storeTask({ ...override, id: targetId }, "override");
    return;
  }
  if (utils.isResource(override)) {
    registry.storeResource({ ...override, id: targetId }, "override");
    return;
  }
  if (utils.isTaskMiddleware(override)) {
    registry.storeTaskMiddleware({ ...override, id: targetId }, "override");
    return;
  }
  if (utils.isResourceMiddleware(override)) {
    registry.storeResourceMiddleware({ ...override, id: targetId }, "override");
    return;
  }
  registry.storeHook({ ...(override as IHook), id: targetId }, "override");
}
