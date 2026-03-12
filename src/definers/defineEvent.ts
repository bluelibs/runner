import {
  IEvent,
  IEventDefinition,
  symbolDefinitionIdentity,
  symbolEvent,
  symbolFilePath,
  symbolOptionalDependency,
  IOptionalDependency,
} from "../defs";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { isFrameworkDefinitionMarked } from "./markFrameworkDefinition";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

export function defineEvent<
  TSchema extends ValidationSchemaInput<any>,
  TTransactional extends boolean | undefined = boolean | undefined,
  TParallel extends boolean | undefined = boolean | undefined,
>(
  config: Omit<
    IEventDefinition<InferValidationSchemaInput<TSchema>>,
    "payloadSchema"
  > & {
    payloadSchema: TSchema;
    transactional?: TTransactional;
    parallel?: TParallel;
  },
): IEvent<InferValidationSchemaInput<TSchema>> & {
  parallel?: TParallel;
  transactional?: TTransactional;
};
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
  assertDefinitionId("Event", eventConfig.id, {
    allowReservedDottedNamespace: isFrameworkDefinitionMarked(eventConfig),
  });
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
  const definitionIdentity = {};
  return deepFreeze({
    ...eventConfig,
    id: eventConfig.id,
    [symbolDefinitionIdentity]: definitionIdentity,
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
