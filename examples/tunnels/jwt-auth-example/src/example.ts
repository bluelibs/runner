import { createHttpClient, r, resources, run, tags } from "@bluelibs/runner";
import {
  rpcLanesResource,
  type RpcLanesResourceValue,
} from "@bluelibs/runner/node";
import type { RpcLaneRequestOptions } from "@bluelibs/runner";

const RpcPath = "/__runner";
const Host = "127.0.0.1";
const ExposureToken = "demo-exposure-token";
const LaneSecret = "demo-lane-secret";

const ResourceId = {
  App: "app",
  Server: {
    Communicator: "serverCommunicator",
    RpcLanes: "serverRpcLanes",
  },
  Client: {
    Communicator: "clientCommunicator",
    RpcLanes: "clientRpcLanes",
  },
} as const;

const TaskId = {
  Hello: "hello",
  CallHello: "callHello",
} as const;

const Profile = {
  Client: "client",
  Server: "server",
} as const;

const jwtProtectedLane = r.rpcLane("protectedLane").build();

type HelloTaskInput = { message: string };

const helloServerTask = r
  .task<HelloTaskInput>(TaskId.Hello)
  .tags([tags.rpcLane.with({ lane: jwtProtectedLane })])
  .run(async (input): Promise<void> => {
    console.log(
      `[server] Received protected message: "${input.message}" via rpcLanes`,
    );
  })
  .build();

const ErrorMessage = {
  MustRouteThroughRpcLanes: "Task must be executed through rpcLanes routing.",
  UnexpectedRemoteCall:
    "Server should never call remote lane for served tasks.",
  MissingExposure: "RPC lane HTTP exposure is unavailable.",
  MissingExposureServer: "RPC lane HTTP server is unavailable.",
  MissingExposureAddress: "RPC lane HTTP server address is unavailable.",
  UnsupportedPipe: "Named pipe addresses are unsupported in this example.",
} as const;

const helloRemoteTask = r
  .task<HelloTaskInput>(TaskId.Hello)
  .tags([tags.rpcLane.with({ lane: jwtProtectedLane })])
  .run(async (): Promise<void> => {
    throw new Error(ErrorMessage.MustRouteThroughRpcLanes);
  })
  .build();

const callHelloTask = r
  .task<void>(TaskId.CallHello)
  .dependencies({ hello: helloRemoteTask })
  .run(async (_input, deps): Promise<void> => {
    await deps.hello({ message: "Hello from RPC lane client" });
  })
  .build();

type BuildServerAppOptions = {
  exposureToken: string;
  laneSecret: string;
};

function buildServerApp(options: BuildServerAppOptions) {
  const communicator = r
    .resource<void>(ResourceId.Server.Communicator)
    .init(async () => ({
      task: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteCall);
      },
      event: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteCall);
      },
      eventWithResult: async (): Promise<never> => {
        throw new Error(ErrorMessage.UnexpectedRemoteCall);
      },
    }))
    .build();

  const topology = r.rpcLane.topology({
    profiles: {
      [Profile.Client]: { serve: [] },
      [Profile.Server]: { serve: [jwtProtectedLane] },
    },
    bindings: [
      {
        lane: jwtProtectedLane,
        communicator,
        auth: { mode: "jwt_hmac", secret: options.laneSecret },
      },
    ],
  });

  const rpcLanes = rpcLanesResource.fork(ResourceId.Server.RpcLanes).with({
    profile: Profile.Server,
    mode: "network",
    topology,
    exposure: {
      http: {
        basePath: RpcPath,
        listen: { port: 0, host: Host },
        auth: { token: options.exposureToken },
      },
    },
  });

  const app = r
    .resource(ResourceId.App)
    .register([helloServerTask, communicator, rpcLanes])
    .build();

  return { app, rpcLanes };
}

type BuildClientAppOptions = {
  baseUrl: string;
  exposureToken: string;
  laneSecret: string;
};

function buildClientApp(options: BuildClientAppOptions) {
  const communicator = r
    .resource<void>(ResourceId.Client.Communicator)
    .dependencies({ serializer: resources.serializer })
    .init(async (_cfg, deps) => {
      const client = createHttpClient({
        baseUrl: options.baseUrl,
        auth: { token: options.exposureToken },
        serializer: deps.serializer,
      });
      return {
        task: async (
          taskId: string,
          input?: unknown,
          requestOptions?: RpcLaneRequestOptions,
        ) => client.task(taskId, input, requestOptions),
      };
    })
    .build();

  const topology = r.rpcLane.topology({
    profiles: {
      [Profile.Client]: { serve: [] },
      [Profile.Server]: { serve: [jwtProtectedLane] },
    },
    bindings: [
      {
        lane: jwtProtectedLane,
        communicator,
        auth: { mode: "jwt_hmac", secret: options.laneSecret },
      },
    ],
  });

  const rpcLanes = rpcLanesResource.fork(ResourceId.Client.RpcLanes).with({
    profile: Profile.Client,
    mode: "network",
    topology,
  });

  const app = r
    .resource(ResourceId.App)
    .register([communicator, helloRemoteTask, callHelloTask, rpcLanes])
    .build();

  return { app, callHelloTask };
}

function getBaseUrl(value: RpcLanesResourceValue): string {
  const handlers = value.exposure?.getHandlers?.();
  if (!handlers) {
    throw new Error(ErrorMessage.MissingExposure);
  }

  const server = handlers.server;
  if (!server) {
    throw new Error(ErrorMessage.MissingExposureServer);
  }

  const address = server.address();
  if (!address) {
    throw new Error(ErrorMessage.MissingExposureAddress);
  }
  if (typeof address === "string") {
    throw new Error(ErrorMessage.UnsupportedPipe);
  }

  const basePath = handlers.basePath.endsWith("/")
    ? handlers.basePath.slice(0, -1)
    : handlers.basePath;
  return `http://${Host}:${address.port}${basePath}`;
}

export async function runJwtAuthExample(): Promise<void> {
  const { app: serverApp, rpcLanes } = buildServerApp({
    exposureToken: ExposureToken,
    laneSecret: LaneSecret,
  });

  const serverRuntime = await run(serverApp);
  try {
    const rpcLanesValue = serverRuntime.getResourceValue(rpcLanes.resource);
    const baseUrl = getBaseUrl(rpcLanesValue);

    const { app: goodClientApp, callHelloTask: goodCallTask } = buildClientApp({
      baseUrl,
      exposureToken: ExposureToken,
      laneSecret: LaneSecret,
    });
    const goodClientRuntime = await run(goodClientApp);
    try {
      await goodClientRuntime.runTask(goodCallTask);
      console.log("Authorized remote call succeeded.");
    } finally {
      await goodClientRuntime.dispose();
    }

    const { app: badClientApp, callHelloTask: badCallTask } = buildClientApp({
      baseUrl,
      exposureToken: ExposureToken,
      laneSecret: "invalid-lane-secret",
    });
    const badClientRuntime = await run(badClientApp);
    try {
      await badClientRuntime.runTask(badCallTask);
      console.error("Unexpected success for invalid lane JWT secret.");
      process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("Expected authorization failure:", message);
    } finally {
      await badClientRuntime.dispose();
    }
  } finally {
    await serverRuntime.dispose();
  }
}
