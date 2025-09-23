import type { ITag, ITagMeta, IValidationSchema } from "../../defs";
import { defineTag } from "../defineTag";

type BuilderState<TConfig, TEnforceIn, TEnforceOut> = Readonly<{
  id: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<any>;
  config?: TConfig;
}>;

function clone<TConfig, TEnforceIn, TEnforceOut>(
  s: BuilderState<TConfig, TEnforceIn, TEnforceOut>,
  patch: Partial<BuilderState<TConfig, TEnforceIn, TEnforceOut>>,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<
    TConfig,
    TEnforceIn,
    TEnforceOut
  >;
}

export interface TagFluentBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
> {
  id: string;
  meta<TNewMeta extends ITagMeta>(
    m: TNewMeta,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut>;
  configSchema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut>;
  config<TNewConfig>(
    config: TNewConfig,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut>;
  build(): ITag<TConfig, TEnforceIn, TEnforceOut>;
}

function makeTagBuilder<TConfig, TEnforceIn, TEnforceOut>(
  state: BuilderState<TConfig, TEnforceIn, TEnforceOut>,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut> {
  const b: TagFluentBuilder<any, any, any> = {
    id: state.id,
    meta(m) {
      const next = clone(state, { meta: m as unknown as ITagMeta });
      return makeTagBuilder(next);
    },
    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone(state, { configSchema: schema });
      return makeTagBuilder<TNewConfig, TEnforceIn, TEnforceOut>(
        next as unknown as BuilderState<TNewConfig, TEnforceIn, TEnforceOut>,
      );
    },
    config<TNewConfig>(config: TNewConfig) {
      const next = clone(state, { config: config as unknown as TConfig });
      return makeTagBuilder<TNewConfig, TEnforceIn, TEnforceOut>(
        next as unknown as BuilderState<TNewConfig, TEnforceIn, TEnforceOut>,
      );
    },
    build() {
      return defineTag<TConfig, TEnforceIn, TEnforceOut>({
        id: state.id,
        meta: state.meta,
        configSchema: state.configSchema as any,
        config: state.config as any,
      });
    },
  };
  return b as TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut>;
}

export function tagBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
>(id: string): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut> {
  const initial: BuilderState<TConfig, TEnforceIn, TEnforceOut> = Object.freeze(
    {
      id,
      meta: {} as any,
      configSchema: undefined as any,
      config: undefined as any,
    },
  );
  return makeTagBuilder(initial);
}

export const tag = tagBuilder;
