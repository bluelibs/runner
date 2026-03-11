import { Match, r } from "@bluelibs/runner";

export interface HttpRouteConfig {
  method: "get" | "post";
  path: string;
  responseType: "json" | "markdown";
  inputFrom?: "none" | "body";
  admin?: boolean;
}

const httpRouteConfigSchema = Match.compile({
  method: Match.OneOf("get", "post"),
  path: Match.NonEmptyString,
  responseType: Match.OneOf("json", "markdown"),
  inputFrom: Match.Optional(Match.OneOf("none", "body")),
  admin: Match.Optional(Boolean),
});

export const httpRoute = r
  .tag<HttpRouteConfig>("http-route")
  .for(["tasks"])
  .configSchema(httpRouteConfigSchema)
  .build();
