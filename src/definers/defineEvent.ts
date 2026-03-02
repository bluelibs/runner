import {
  IEvent,
  IEventDefinition,
  symbolEvent,
  symbolFilePath,
  symbolOptionalDependency,
  IOptionalDependency,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

export function defineEvent<
  TPayload = void,
  TTransactional extends boolean | undefined = boolean | undefined,
  TParallel extends boolean | undefined = boolean | undefined,
>(
  config: IEventDefinition<TPayload> & {
    transactional?: TTransactional;
    parallel?: TParallel;
  },
): IEvent<TPayload> & {
  parallel?: TParallel;
  transactional?: TTransactional;
};
export function defineEvent<TPayload = void>(
  config: IEventDefinition<TPayload>,
): IEvent<TPayload> {
  const callerFilePath = getCallerFile();
  const eventConfig = config;
  const payloadSchema = normalizeOptionalValidationSchema(
    eventConfig.payloadSchema,
    {
      definitionId: eventConfig.id,
      subject: "Event payload",
    },
  );
  assertTagTargetsApplicableTo(
    "events",
    "Event",
    eventConfig.id,
    eventConfig.tags,
  );
  return deepFreeze({
    ...eventConfig,
    id: eventConfig.id,
    [symbolFilePath]: callerFilePath,
    [symbolEvent]: true, // This is a workaround
    tags: eventConfig.tags || [],
    payloadSchema,
    parallel: eventConfig.parallel,
    transactional: eventConfig.transactional,
    optional() {
      const wrapper = {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<IEvent<TPayload>>;
      return freezeIfLineageLocked(this, wrapper);
    },
  });
}
