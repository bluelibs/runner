# BlueLibs Runner

<p align="center">
<a href="https://travis-ci.org/bluelibs/runner"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://coveralls.io/github/bluelibs/runner?branch=main"><img src="https://coveralls.io/repos/github/bluelibs/runner/badge.svg?branch=main" alt="Coverage Status" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
</p>

These are the building blocks to create amazing applications. It's a more functional approach to building small and large-scale applications.

These are the building blocks:

- **Tasks**: Core units of logic that encapsulate specific tasks. They can depend on resources, other tasks, and event emitters.
- **Resources**: Singleton objects providing shared functionality. They can be constants, services, functions. They can depend on other resources, tasks, and event emitters.
- **Events**: Facilitate asynchronous communication between different parts of your application. All tasks and resources emit events, allowing you to easily hook. Events can be listened to by tasks, resources, and middleware.
- **Middleware**: Intercept and modify the execution of tasks. They can be used to add additional functionality to your tasks. Middleware can be global or task-specific.

These are the concepts and philosophy:

- **Async**: Everything is async, no more sync code for this framework. Sync-code can be done via resource services or within tasks, but the high-level flow needs to run async.
- **Type safety**: Built with TypeScript for enhanced developer experience and type-safety everywhere, no more type mistakes.
- **Functional**: We use functions and objects instead of classes for DI. This is a functional approach to building applications.
- **Explicit Registration**: All tasks, resources, events, and middleware have to be explicitly registered to be used.
- **Dependencies**: Tasks, resources, and middleware can have access to each other by depending on one another and event emitters. This is a powerful way to explicitly declare the dependencies.

Resources return through `async init()` their value to the container which can be used throughout the application. Resources might not have a value, they can just register things, like tasks, events, or middleware.

Tasks return through `async run()` function and the value from run, can be used throughout the application.

All tasks, resources, events, and middleware have to be explicitly registered to be used. Registration can only be done in resources.

## Installation

```bash
npm install @bluelibs/runner
```

## Basic Usage

```typescript
import { task, run, resource } from "@bluelibs/runner";

const minimal = resource({
  async init() {
    return "Hello world!";
  },
});

run(minimal).then((result) => {
  expect(result).toBe("Hello world!");
});
```

## Resources and Tasks

Resources are singletons. They can be constants, services, functions, etc. They can depend on other resources, tasks, and event emitters.

On the other hand, tasks are designed to be trackable units of logic. Like things that handle a specific route on your HTTP server, or any kind of action that is needed from various places. This will allow you to easily track what is happening in your application.

```ts
import { task, run, resource } from "@bluelibs/runner";

const helloTask = task({
  id: "app.hello",
  run: async () => console.log("Hello World!"),
});

const app = resource({
  id: "app",
  register: [helloTask],
  dependencies: {
    hello: helloTask,
  },
  async init(_, deps) {
    await deps.hello();
  },
});
```

### When to use each?

It is unrealistic to create a task for everything you're doing in your system, not only it will be tedious for the developer, but it will affect performance unnecessarily. The idea is to think of a task of something that you want trackable as an action, for example:

- "app.user.register" - this is a task, registers the user, returns a token
- "app.user.createComment" - this is a task, creates a comment, returns the comment
- "app.user.updateFriendList" - this task can be re-used from many other tasks or resources as necessary

Resources are more like services, they are singletons, they are meant to be used as a shared functionality across your application. They can be constants, services, functions, etc.

### Resource dispose()

Resources can have a `dispose()` method that can be used to clean up resources. This is useful for cleaning up resources like closing database connections, etc. You typically want to use this when you have opened pending connections or you need to do some cleanup or a graceful shutdown.

```ts
import { task, run, resource } from "@bluelibs/runner";

const dbResource = resource({
  async init(config, deps) {
    const db = await connectToDatabase();
    return db;
  },
  async dispose(db, config, deps) {
    return db.close();
  },
});
```

If you want to call dispose, you have to do it through the global store.

```ts
import { task, run, resource, globals } from "@bluelibs/runner";

const app = resource({
  id: "app",
  register: [dbResource],
  dependencies: {
    store: globals.resources.store,
  },
  async init(_, deps) {
    return {
      dispose: async () => deps.store.dispose(),
    };
  },
});

const value = await run(app);
// To begin the disposal process.
await value.dispose();
```

## Encapsulation

We want to make sure that our tasks are not dependent on the outside world. This is why we have the `dependencies` object.

You cannot call on an task outside from dependencies. And not only that, it has to be explicitly registered to the container.

## Dependencies

You can depend on `tasks`, `resources`, `events` and `middleware`.

```ts
import { task, resource, run, event } from "@bluelibs/runner";

const helloWorld = task({
  middleware: [logMiddleware],
  dependencies: {
    userRegisteredEvent,
  },
});

const app = resource({
  id: "app",
  register: [helloWorld],
  dependencies: {
    helloWorld,
  },
  async init(_, deps) {
    await deps.helloWorld();
  },
});

run(app);
```

Resources can also depend on other resources and tasks. We have a circular dependency checker which ensures consistency. If a circular dependency is detected, an error will be thrown showing you the exact pathways.

Tasks are not limited to this constraint, actions can use depend on each other freely.

## Events

You emit events when certain things in your app happen, a user registered, a comment has been added, etc.
You listen to them through tasks and resources, and you can emit them from tasks and resources through `dependencies`.

```ts
import { task, run, event } from "@bluelibs/runner";

const afterRegisterEvent = event<{ userId: string }>({
  id: "app.user.afterRegister",
});

const root = resource({
  id: "app",
  register: [afterRegisterEvent],
  dependencies: {
    afterRegisterEvent,
  },

  async init(_, deps) {
    // the event becomes a function that you run with the propper payload
    await deps.afterRegisterEvent({ userId: string });
  },
});
```

There are only 2 ways to listen to events:

### `on` property

```ts
import { task, run, event } from "@bluelibs/runner";

const afterRegisterEvent = event<{ userId: string }>({
  id: "app.user.afterRegister",
});

const helloTask = task({
  id: "app.hello",
  on: afterRegisterEvent,
  run(event) {
    console.log("User has been registered!");
  },
});

const root = resource({
  id: "app",
  register: [afterRegisterEvent, helloTask],
  dependencies: {
    afterRegisterEvent,
  },
  async init(_, deps) {
    deps.afterRegisterEvent({ userId: "XXX" });
  },
});
```

### `hooks` property

This can only be applied to a `resource()`.

```ts
import { task, resource, run, event, global } from "@bluelibs/runner";

const afterRegisterEvent = event<{ userId: string }>({
  id: "app.user.registered",
});

const root = resource({
  id: "app",
  register: [afterRegisterEvent],
  dependencies: {},
  hooks: [
    {
      event: global.events.afterInit,
      async run(event, deps) {
        console.log("User has been registered!");
      },
    },
  ],
  async init(_, deps) {
    deps.afterRegisterEvent({ userId: "XXX" });
  },
});
```

When using hooks, inside resource() you benefit of autocompletion, in order to keep things clean, if your hooks become large and long consider switching to tasks and `on`. This is a more explicit way to listen to events, and your resource registers them.

The hooks from a `resource` are mostly used for configuration, and blending in the system.

## Middleware

Middleware is a way to intercept the execution of tasks. It's a powerful way to add additional functionality to your tasks. First middleware that gets registered is the first that runs, the last middleware that runs is 'closest' to the task, most likely the last element inside `middleware` array at task level.

```ts
import { task, run, event } from "@bluelibs/runner";

const logMiddleware = middleware({
  id: "app.middleware.log",
  dependencies: {
    // inject tasks, resources, eventCallers here.
  },
  async run(data, deps) {
    const { taskDefinition, next, input } = data;

    console.log("Before task", taskDefinition.id);
    const result = await next(input); // pass the input to the next middleware or task
    console.log("After task", taskDefinition.id);

    return result;
  },
});

const helloTask = task({
  id: "app.hello",
  middleware: [logMiddleware],
  run(event) {
    console.log("User has been registered!");
  },
});
```

You can use middleware creators (function that returns) for configurable middlewares such as:

```ts
import { middleware } from "@bluelibs/runner";

function createLogMiddleware(config) {
  return middleware({
    // your config-based middleware here.
  });
}
```

However, if you want to register a middleware for all tasks, here's how you can do it:

```ts
import { run, resource } from "@bluelibs/runner";

const logMiddleware = middleware({
  id: "app.middleware.log",
  async run(data, deps) {
    const { taskDefinition, next, input } = data;

    console.log("Before task", task.id);
    const result = await next(input);
    console.log("After task", task.id);

    return result;
  },
});

const root = resource({
  id: "app",
  register: [logMiddleware.global() /* this will apply to all tasks */],
});
```

The middleware can only be registered once. This means that if you register a middleware as global, you cannot specify it as a task middleware.

### Middleware for resources

Unfortunately, middleware for resources is not supported at the moment. The main reason for this is simplicity and the fact that resources are not meant to be executed, but rather to be initialized.

You have access to the global events if you want to hook into the initialisation system.

### When to use either?

- `hooks` are for resources to extend each other, compose functionalities, they are mostly used for configuration and blending in the system.
- `on` is for when you want to perform a task when something happens.

## Errors

If an error is thrown in a task, the error will be propagated up.

```ts
import { task, run, event } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
  run() {
    throw new Error("Something went wrong");
  },
});

const app = resource({
  id: "app",
  register: [helloWorld],
  dependencies: {
    helloWorld,
  },
  async init() {
    await helloWorld();
  },
});

run(app);
```

You can listen to errors via events:

```ts
const helloWorld = task({
  id: "app.onError",
  on: helloWorld.events.onError,
  run({ error, input }, deps) {
    // this will be called when an error happens
  },
});
```

## Metadata

You can attach metadata to tasks, resources, events, and middleware.

```ts
import { task, run, event } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
  meta: {
    title: "Hello World",
    description: "This is a hello world task",
    tags: ["api"],
  },
  run() {
    return "Hello World!";
  },
});
```

This is particularly helpful to use in conjunction with global middlewares, or global events, etc.

The interfaces look like this:

```ts
export interface IMeta {
  title?: string;
  description?: string;
  tags: string[];
}

export interface ITaskMeta extends IMeta {}
export interface IResourceMeta extends IMeta {}
export interface IEventMeta extends IMeta {}
export interface IMiddlewareMeta extends IMeta {}
```

Which means you can extend them in your system to add more keys to better describe your actions.

## Global Services

We expose direct access to the following internal services:

- Store (contains Map()s for events, tasks, resources, middleware configurations)
- TaskRunner (can run tasks definitions directly and within D.I. context)
- EventManager (can emit and listen to events)

Attention, it is not recommended to use these services directly, but they are exposed for advanced use-cases, for when you do not have any other way.

```ts
import { task, run, event, globals } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
  dependencies: {
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
  }
  run(_, deps) {
    // you benefit of full autocompletion here
  },
});
```

## Namespacing

We typically namespace using `.` like `app.helloWorld`. This is a convention that we use to make sure that we can easily identify where the task belongs to.

When creating special packages the convention is:

- `{companyName}.{packageName}.{taskName}`

You can always create helpers for you as you're creating your tasks, resources, middleware:

```ts
function getNamespace(id) {
  return `bluelibs.core.${id}`;
}
```

We need to import all the tasks, resources, events, and middlewares, a convention for their naming is to export them like this

```ts
import { userCreatedEvent } from "./events";
export const events = {
  userCreated: userCreatedEvent,
  // ...
};

export const tasks = {
  doSomething: doSomethingTask,
};

export const resources = {
  root: rootResource,
  user: userResource,
};
```

Often the root will register all needed items, so you don't have to register anything but the root.

```ts
import { resource } from "@bluelibs/runner";
import * as packageName from "package-name";

const app = resource({
  id: "app",
  register: [packageName.resources.root],
});

run(app);
```

Now you can freely use any of the tasks, resources, events, and middlewares from the `packageName` namespace.

This approach is very powerful when you have multiple packages and you want to compose them together.

## Real world usage.

Typically you have an express server (to handle HTTP requests), a database, and a bunch of services. You can define all of these in a single file and run them.

```ts
import { task, resource, run, event } from "@bluelibs/runner";
import express from "express";

const expressServer = resource({
  id: "app.express",
  async init() {
    const app = express();
    app.listen(3000).then(() => {
      console.log("Server is running on port 3000");
    });

    // because we return it you can now access it via dependencies
    return app;
  },
});

const setupRoutes = resource({
  id: "app.routes",
  dependencies: {
    expressServer,
  },
  async init(_, deps) {
    deps.expressServer.use("/api", (req, res) => {
      res.json({ hello: "world" });
    });
  },
});

// Just run them, init() will be called everywhere.
const app = resource({
  id: "app",
  register: [expressServer, setupRoutes],
});

run();
```

The system is smart enough to know which `init()` to call first. Typically all dependencies are initialised first. If there are circular dependencies, an error will be thrown with the exact paths.

### Business config

There's a resource for that! You can define a resource that holds your business configuration.

```ts
import { resource, run } from "@bluelibs/runner";

// we keep it as const because we will also benefit of type-safety
const businessData = {
  pricePerSubscription: 9.99,
};

const businessConfig = resource({
  id: "app.config",
  async init() {
    return businessData;
  },
});

const app = resource({
  id: "app",
  register: [businessConfig],
  dependencies: { businessConfig },
  async init(_, deps) {
    console.log(deps.businessConfig.pricePerSubscription);
  },
});

run();
```

### Resources can receive configs

Resources are super configurable.

```ts
import { resource, run } from "@bluelibs/runner";

type EmailerOptions = {
  smtpUrl: string;
  defaultFrom: string;
};

const emailerResource = resource({
  id: "app.config",
  async init(config: EmailerOptions) {
    return {
      sendEmail: async (to: string, subject: string, body: string) => {
        // send *email*
      },
    };
    // or return some service that sends email
  },
});

const app = resource({
  id: "app",
  register: [
    // You can pass the config here
    emailerResource.with({
      smtpUrl: "smtp://localhost",
      defaultFrom: "",
    }),
    // Leaving it simply emailerResource is similar to passing an empty object.
    // We leave this for simplicity in some cases but we recommend using .with() for clarity.
  ],
});

run(app);
```

## Useful events

### Task level

```ts
import { task, run, event } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
});

// Each task and constant have their own events
const app = resource({
  id: "app",
  register: [helloWorld],
  hooks: [
    {
      event: helloWorld.events.beforeRun,
      async run(event, deps) {
        event.data.input; // read the input
      },
    },
    {
      event: helloWorld.events.afterRun,
      async run(event, deps) {
        event.data.output; // you can read the input or output
      },
    },
    {
      event: helloWorld.events.onError,
      async run(event, deps) {
        event.data.error; // read the error that happened during execution
      },
    },
  ],
});

run(app);
```

## Resource level

```ts
import { task, run, event } from "@bluelibs/runner";

const businessConfig = resource({
  id: "app.config",
  async init() {
    return businessData;
  },
});

const app = resource({
  id: "app",
  register: [businessConfig],
  hooks: [
    {
      event: businessConfig.events.beforeInit,
      async run(event, deps) {
        event.data.config; // read the input
      },
    },
    {
      event: businessConfig.events.afterInit,
      async run(event, deps) {
        event.data.value; // you can read the  returned value of the resource
      },
    },
    {
      event: businessConfig.events.onError,
      async run(event, deps) {
        event.data.error; // read the error that happened during initialization
      },
    },
  ],
});

run(app);
```

## Moving further

This is just a "language" of developing applications. It simplifies dependency injection to the barebones, it forces you to think more functional and use classes less.

You can add many services or external things into the runner ecosystem with things like:

```ts
import { task, run, event } from "@bluelibs/runner";

const expressResource = resource<express.Application>({
  id: "app.helloWorld",
  run: async (config) => config,
});

const app = resource({
  id: "app",
  register: [expressResource.with(express())],
  init: async (express) => {
    express.get("/", (req, res) => {
      res.send("Hello World!");
    });
  },
});

run(app);
```

This shows how easy you encapsulate an external service into the runner ecosystem. This 'pattern' of storing objects like this is not that common because usually they require a configuration with propper options and stuff, not an express instance(), like this:

```ts
const expressResource = resource({
  id: "app.helloWorld",
  run: async (config) => {
    const app = express();
    app.listen(config.port);
    return app;
  },
});

const app = resource({
  id: "app",
  register: [expressResource.with({ port: 3000 })],
  init: async (express) => {
    // type is automagically infered.
    express.get("/", (req, res) => {
      res.send("Hello World!");
    });
  },
});

run(app);
```

## Inter-communication between resources

By stating dependencies you often don't care about the initialisation order, but sometimes you really do, for example, let's imagine a security service that allows you to inject a custom hashing function let's say to shift from md5 to sha256.

This means your `resource` needs to provide a way for other resources to `update` it. The most obvious way is to expose a configuration that allows you to set a custom hasher `register: [securityResource.with({ ... })]`.

But other resources might want to do this dynamically as extensions. This is where `hooks` come in.

```ts
import { resource, run, event } from "@bluelibs/runner";

type SecurityOptions = {
  hashFunction: (input: string) => string;
};

const securityResource = resource({
  id: "app.security",
  async init(config: SecurityOptions) {
    let hasher = config.hashFunction;
    return {
      setHasher: (hashFunction: (input: string) => string) => {
        hasher = hashFunction;
      },
      hash: (input: string) => hasher(input),
    };
  },
});

const app = resource({
  id: "app",
  register: [securityResource],
  hooks: [
    {
      event: securityResource.events.afterInit,
      async run(event, deps) {
        const { config, value } = event.data;
        const security = value;

        security.setHasher((input) => {
          // custom implementation here.
        });
      },
    },
  ],
});
```

Another approach is to create a new event that holds the config and it allows it to be updated.

```ts
import { resource, run, event } from "@bluelibs/runner";

const securityConfigurationPhaseEvent = event<SecurityOptions>({
  id: "app.security.configurationPhase",
});

const securityResource = resource({
  id: "app.security",
  dependencies: {
    securityConfigurationPhaseEvent,
  },
  async init(config: SecurityOptions) {
    // Give the ability to other listeners to modify the configuration
    securityConfigurationPhaseEvent(config);

    return {
      // ... based on config
    };
  },
});

const app = resource({
  id: "app",
  register: [securityResource],
  hooks: [
    {
      event: securityConfigurationPhaseEvent,
      async run(event, deps) {
        const { config } = event.data; // config is SecurityOptions
        config.setHasher(newHashFunction);
      },
    },
  ],
});
```

## Logging

We expose through globals a logger that you can use to log things.

By default logs are not printed unless a resource listens to the log event. This is by design, when something is logged an event is emitted. You can listen to this event and print the logs.

```ts
import { task, run, event, globals } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (_, { logger }) => {
    await logger.info("Hello World!");
    // or logger.log(level, data);
  },
});
```

### Logs Summary Table

| Log Level    | Description                               | Usage Example                          |
| ------------ | ----------------------------------------- | -------------------------------------- |
| **trace**    | Very detailed logs, usually for debugging | "Entering function X with params Y."   |
| **debug**    | Detailed debug information                | "Fetching user data: userId=123."      |
| **info**     | General application information           | "Service started on port 8080."        |
| **warn**     | Indicates a potential issue               | "Disk space running low."              |
| **error**    | Indicates a significant problem           | "Unable to connect to database."       |
| **critical** | Serious problem causing a crash           | "System out of memory, shutting down." |

### Print logs

Logs don't get printed by default in this system.

```ts
import { task, run, event, globals, resource } from "@bluelibs/runner";

const printLog = task({
  id: "app.task.printLog",
  on: globals.events.log,
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (event, { logger }) => {
    logger.print(event);
  },
});

const app = resource({
  id: "root",
  register: [printLog],
});

// Now your app will print all logs
```

You can in theory do it in `hooks` as well, but as specified `hooks` are mostly used for configuration and blending in the system.

The logger's `log()` function is async as it works with events. If you don't want your system hanging on logs, simply omit the `await`

## Overrides

Previously, we explored how we can extend functionality through events. However, sometimes you want to override a resource with a new one or simply swap out a task or a middleware that you import from another package and they don't offer the ability.

```ts
import { resource, run, event } from "@bluelibs/runner";

// This example is for resources but override works for tasks, events, and middleware as well.
const securityResource = resource({
  id: "app.security",
  async init() {
    // returns a security service
  },
});

const override = resource({
  ...securityResource,
  init: async () => {
    // a new and custom service
  },
});

const app = resource({
  id: "app",
  register: [securityResource], // this resource might be registered by any element in the dependency tree.
  overrides: [override],
});
```

Now the `securityResource` will be overriden by the new one and whenever it's used it will use the new one.

Overrides can only happen once and only if the overriden resource is registered. If two resources try to override the same resource, an error will be thrown.

## Testing

### Unit Testing

You can easily test your resources and tasks by running them in a test environment.

The only bits that you need to test are the `run` function and the `init` functions with the propper dependencies.

```ts
import { task, resource } from "@bluelibs/runner";

const helloWorld = task({
  id: "app.helloWorld",
  run: async () => {
    return "Hello World!";
  },
});

const helloWorldResource = resource({
  id: "app.helloWorldResource",
  init: async () => {
    return "Hello World!";
  },
});

// sample tests for the task
describe("app.helloWorld", () => {
  it("should return Hello World!", async () => {
    const result = await helloWorld.run(input, dependencies); // pass in the arguments and the mocked dependencies.
    expect(result).toBe("Hello World!");
  });
});

// sample tests for the resource
describe("app.helloWorldResource", () => {
  it("should return Hello World!", async () => {
    const result = await helloWorldResource.init(config, dependencies); // pass in the arguments and the mocked dependencies.
    expect(result).toBe("Hello World!");
  });
});
```

### Integration

Unit testing can be very simply with mocks, since all dependencies are explicit. However, if you would like to run an integration test, and have a task be tested and within the full container.

```ts
import { task, resource, run, global } from "@bluelibs/runner";

const task = task({
  id: "app.myTask",
  run: async () => {
    return "Hello World!";
  },
});

const app = resource({
  id: "app",
  register: [myTask],
});
```

Then your tests can now be cleaner:

```ts
describe("app", () => {
  it("an example to override a task or resource", async () => {
    const testApp = resource({
      id: "app.test",
      register: [myApp], // wrap your existing app
      overrides: [override], // apply the overrides
      init: async (_, deps) => {
        // you can now test a task simply by depending on it, and running it, then asserting the response of run()
      },
    });

    // Same concept applies for resources as well.

    await run(testApp);
  });
});
```

## Support

This package is part of the [BlueLibs](https://www.bluelibs.com) family. If you enjoy this work, please show your support by starring [the main repository](https://github.com/bluelibs/runner).

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
