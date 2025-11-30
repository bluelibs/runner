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
  const callerFilePath = getCallerFile();
  const eventConfig = config;
  return {
    ...eventConfig,
    id: eventConfig.id,
    [symbolFilePath]: callerFilePath,
    [symbolEvent]: true, // This is a workaround
    tags: eventConfig.tags || [],
    parallel: eventConfig.parallel,
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<IEvent<TPayload>>;
    },
  };
}
