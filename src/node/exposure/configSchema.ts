import type { IValidationSchema } from "../../defs";
import { Match } from "../../tools/check";
import type {
  NodeExposureConfig,
  NodeExposureHttpConfig,
} from "./resourceTypes";

const exposureServerPattern = Match.Where(
  (value: unknown): value is NonNullable<NodeExposureHttpConfig["server"]> =>
    value !== null && typeof value === "object",
);

const nodeExposureConfigPattern = Match.ObjectIncluding({
  http: Match.Optional(
    Match.ObjectIncluding({
      basePath: Match.Optional(String),
      server: Match.Optional(exposureServerPattern),
      listen: Match.Optional(
        Match.ObjectIncluding({
          port: Match.PositiveInteger,
          host: Match.Optional(String),
        }),
      ),
      auth: Match.Optional(
        Match.ObjectIncluding({
          header: Match.Optional(String),
          token: Match.Optional(Match.OneOf(String, [String])),
          allowAnonymous: Match.Optional(Boolean),
        }),
      ),
      cors: Match.Optional(
        Match.ObjectIncluding({
          origin: Match.Optional(
            Match.OneOf(String, [String], RegExp, Function),
          ),
          methods: Match.Optional([String]),
          allowedHeaders: Match.Optional([String]),
          exposedHeaders: Match.Optional([String]),
          credentials: Match.Optional(Boolean),
          maxAge: Match.Optional(Match.PositiveInteger),
          varyOrigin: Match.Optional(Boolean),
        }),
      ),
      limits: Match.Optional(
        Match.ObjectIncluding({
          json: Match.Optional(
            Match.ObjectIncluding({
              maxSize: Match.Optional(Match.PositiveInteger),
            }),
          ),
          multipart: Match.Optional(
            Match.ObjectIncluding({
              fieldNameSize: Match.Optional(Match.PositiveInteger),
              fieldSize: Match.Optional(Match.PositiveInteger),
              fields: Match.Optional(Match.PositiveInteger),
              fileSize: Match.Optional(Match.PositiveInteger),
              files: Match.Optional(Match.PositiveInteger),
              parts: Match.Optional(Match.PositiveInteger),
              headerPairs: Match.Optional(Match.PositiveInteger),
            }),
          ),
        }),
      ),
      dangerouslyAllowOpenExposure: Match.Optional(Boolean),
      disableDiscovery: Match.Optional(Boolean),
    }),
  ),
});

export const nodeExposureConfigSchema: IValidationSchema<NodeExposureConfig> =
  nodeExposureConfigPattern;
