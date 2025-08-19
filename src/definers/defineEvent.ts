import {
  IEvent,
  IEventDefinition,
  symbolEvent,
  symbolFilePath,
  symbolOptionalDependency,
  IOptionalDependency,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";

export function defineEvent<TPayload = void>(
  config: IEventDefinition<TPayload>,
): IEvent<TPayload> {
  /**
   * Define an event.
   * Generates a branded event definition with a stable id (anonymous if omitted)
   * and file path metadata for better debugging.
   *
   * @typeParam TPayload - Payload type carried by the event.
   * @param config - Optional event definition (id, etc.).
   * @returns A branded event definition.
   */
  const callerFilePath = getCallerFile();
  const eventConfig = config;
  return {
    ...eventConfig,
    id: eventConfig.id,
    [symbolFilePath]: callerFilePath,
    [symbolEvent]: true, // This is a workaround
    tags: eventConfig.tags || [],
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<IEvent<TPayload>>;
    },
  };
}