import type { IValidationSchema } from "../../defs";
import { isResource } from "../../define";
import { Match } from "../../tools/check";
import type { RpcLanesResourceConfig } from "./types";
import {
  remoteLaneBindingAuthPattern,
  remoteLanesModePattern,
} from "../remote-lanes/configPatterns";

const laneReferenceShapePattern = Match.ObjectIncluding({
  id: String,
});

const laneReferencePattern = laneReferenceShapePattern;

const communicatorResourcePattern = Match.Any;
const serializerResourcePattern = Match.Where(
  (value: unknown): value is RpcLanesResourceConfig["serializer"] =>
    isResource(value),
);

const rpcLaneProfilePattern = {
  serve: Match.ArrayOf(laneReferencePattern),
};

const rpcLaneRetryPolicyPattern = Match.ObjectIncluding({
  maxAttempts: Match.Optional(Number),
  delayMs: Match.Optional(Match.OneOf(Number, Function)),
  retryIf: Match.Optional(Function),
});

const rpcLanesResourceConfigPattern = Match.ObjectIncluding({
  profile: String,
  topology: Match.ObjectIncluding({
    profiles: Match.MapOf(rpcLaneProfilePattern),
    bindings: Match.ArrayOf(
      Match.ObjectIncluding({
        lane: laneReferencePattern,
        communicator: communicatorResourcePattern,
        allowAsyncContext: Match.Optional(Boolean),
        auth: Match.Optional(remoteLaneBindingAuthPattern),
        retry: Match.Optional(rpcLaneRetryPolicyPattern),
      }),
    ),
  }),
  serializer: Match.Optional(serializerResourcePattern),
  mode: Match.Optional(remoteLanesModePattern),
  exposure: Match.Optional(
    Match.ObjectIncluding({
      http: Match.Optional(Match.ObjectIncluding({})),
    }),
  ),
});

export const rpcLanesResourceConfigSchema: IValidationSchema<RpcLanesResourceConfig> =
  rpcLanesResourceConfigPattern;
