import express, { type Request, type Response } from "express";
import { resources, type ITask, r } from "@bluelibs/runner";

import { assertAdminSecret } from "../budget/budget-ledger.resource";
import { appConfig } from "../config/app-config.resource";
import { httpRoute, type HttpRouteConfig } from "./http-route.tag";
import { httpServer } from "./http.resource";

export type TaggedTaskRoute = {
  config?: HttpRouteConfig;
  definition: ITask<any, Promise<any>, any>;
};

export const httpRouter = r
  .resource("httpRouter")
  .dependencies({
    appConfig,
    httpServer,
    httpRoute: httpRoute.startup(),
    taskRunner: resources.taskRunner,
  })
  .init(async (_config, deps) => {
    registerTaggedHttpRoutes({
      adminSecret: deps.appConfig.adminSecret,
      app: deps.httpServer.app,
      routes: deps.httpRoute.tasks as TaggedTaskRoute[],
      taskRunner: deps.taskRunner,
    });
    return {};
  })
  .build();

export function registerTaggedHttpRoutes(input: {
  adminSecret: string;
  app: express.Express;
  routes: TaggedTaskRoute[];
  taskRunner: { run(task: ITask<any, Promise<any>, any>, taskInput?: unknown): Promise<unknown> };
}): void {
  for (const route of input.routes) {
    const config = route.config;
    if (!config) {
      continue;
    }

    input.app[config.method](config.path, async (req, res) => {
      if (config.admin) {
        assertAdminSecret(req.header("x-admin-secret") ?? undefined, input.adminSecret);
      }

      const result = await input.taskRunner.run(
        route.definition,
        buildTaggedRouteInput(req, config),
      );
      writeTaggedRouteResponse(res, config, result);
    });
  }
}

function buildTaggedRouteInput(req: Request, config: HttpRouteConfig): unknown {
  if (config.inputFrom === "body") {
    return req.body ?? {};
  }

  return {};
}

function writeTaggedRouteResponse(
  res: Response,
  config: HttpRouteConfig,
  result: unknown,
): void {
  if (config.responseType === "markdown") {
    res.type("text/markdown; charset=utf-8").send(String(result ?? ""));
    return;
  }

  res.json(result);
}
