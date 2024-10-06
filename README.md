# BlueLibs Runner

<p align="center">
<a href="https://travis-ci.org/bluelibs/runner"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://coveralls.io/github/bluelibs/runner?branch=main"><img src="https://coveralls.io/repos/github/bluelibs/runner/badge.svg?branch=main" alt="Coverage Status" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
</p>

[View the documentation page here](https://bluelibs.github.io/runner/).

BlueLibs Runner is a framework that provides a functional approach to building applications, whether small or large-scale. Its core concepts include Tasks, Resources, Events, and Middleware. Tasks represent the units of logic, while resources are singletons that provide shared services across the application. Events facilitate communication between different parts of the system, and Middleware allows interception and modification of task execution. The framework emphasizes an async-first philosophy, ensuring that all operations are executed asynchronously for smoother application flow.

## Building Blocks

- **Tasks**: Core units of logic that encapsulate specific tasks. They can depend on resources, other tasks, and event emitters.
- **Resources**: Singleton objects providing shared functionality. They can be constants, services, functions. They can depend on other resources, tasks, and event emitters.
- **Events**: Facilitate asynchronous communication between different parts of your application. All tasks and resources emit events, allowing you to easily hook. Events can be listened to by tasks, resources, and middleware.
- **Middleware**: Intercept and modify the execution of tasks or initialisation of your resources. They can be used to add additional functionality to your tasks. Middleware can be global or task-specific.

These are the concepts and philosophy:

- **Async**: Everything is async, no more sync code for this framework. Sync-code can be done via resource services or within tasks, but the high-level flow needs to run async.
- **Type safety**: Built with TypeScript for enhanced developer experience and type-safety everywhere, no more type mistakes.
- **Functional**: We use functions and objects instead of classes for DI. This is a functional approach to building applications.
- **Explicit Registration**: All tasks, resources, events, and middleware have to be explicitly registered to be used.
- **Dependencies**: Tasks, resources, and middleware can have access to each other by depending on one another and event emitters. This is a powerful way to explicitly declare the dependencies.

Resources return their value to the container using the async `init()` function, making them available throughout the application.

Tasks provide their output through the async `run()` function, allowing the results to be used across the application.

All tasks, resources, events, and middleware must be explicitly registered to be used. Registration can only be done within resources.

## Installation

```bash
npm install @bluelibs/runner
```

## Basic Usage

```typescript
import { run, resource } from "@bluelibs/runner";

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

Resources are singletons and can include constants, services, functions, and more. They can depend on other resources, tasks, and event emitters.

Tasks are designed to be trackable units of logic, such as handling specific routes on your HTTP server or performing actions needed by different parts of the application. This makes it easy to monitor what’s happening in your application.

```ts
import { task, run, resource } from "@bluelibs/runner";

const helloTask = task({
  id: "app.hello",
  run: async () => "Hello World!",
});

const app = resource({
  id: "app",
  register: [helloTask],
  dependencies: {
    hello: helloTask,
  },
  async init(_, deps) {
    return await deps.hello();
  },
});

const result = await run(app); // "Hello World!"
```

### When to use each?

It is unrealistic to create a task for everything you're doing in your system, not only it will be tedious for the developer, but it will affect performance unnecessarily. The idea is to think of a task of something that you want trackable as a higher-level action, for example:

- "app.user.register" - this is a task, registers the user, returns a token
- "app.user.createComment" - this is a task, creates a comment, returns the comment maybe
- "app.user.updateFriendList" - this task can be re-used from many other tasks or resources as necessary

Resources are more like services, they are singletons, they are meant to be used as a shared functionality across your application. They can be constants, services, functions, etc.

### Resource dispose()

Resources can include a `dispose()` method for cleanup tasks. This is useful for actions like closing database connections. You should use `dispose()` when you have open connections or need to perform cleanup during a graceful shutdown.

```ts
import { task, run, resource } from "@bluelibs/runner";

const dbResource = resource({
  async init(config, deps) {
    const db = await connectToDatabase();
    return db;
  },
  // the value returned from init() will be passed to dispose()
  async dispose(db, config, deps) {
    return db.close();
  },
});
```

To call dispose(), you need to use the global resource called store, since everything is encapsulated. This allows you to access the internal parts of the system to start the disposal process.

```ts
import { task, run, resource, globals } from "@bluelibs/runner";

const app = resource({
  id: "app",
  register: [dbResource],
  dependencies: {
    store: globals.resources.store,
  },
  async init(_, deps) {
    // We use the fact that we can reuse the value we got from here
    return {
      dispose: async () => deps.store.dispose(),
    };
  },
});

const value = await run(app);
// To begin the disposal process.
await value.dispose();
```

### Resource configuration

Resources can be set up with a configuration object, which is helpful for passing in specific settings. For example, if you’re building a library and initializing a mailer service, you can provide the SMTP credentials through this configuration.

```ts
import { task, run, resource } from "@bluelibs/runner";

type Config = { smtpUrl: string; defaultFrom: string };

const emailerResource = resource({
  // automatic type inference.
  async init(config: Config) {
    // todo: perform config checks with a library like zod
    return {
      sendEmail: async (to: string, subject: string, body: string) => {
        // send *email*
      },
    };
  },
});

const app = resource({
  id: "app",
  register: [
    // proper autocompletion is present
    emailerResource.with({ smtpUrl: "smtp://localhost", defaultFrom: "" }),
  ],
});
```

If by any chance your main `app` has configs then they will be passed via the second argument of `run`, like this:

```ts
run(app, config);
```

## Dependencies

You can depend on `tasks`, `resources`, `events` and (indirectly) on `middleware`.

```ts
import { task, resource, run, event } from "@bluelibs/runner";

const helloWorld = task({
  middleware: [logMiddleware],
  dependencies: {
    userRegisteredEvent,
  },
  async run(_, deps) {
    await deps.userRegisteredEvent();
    return "Hello World!";
  },
});

const app = resource({
  id: "app",
  // You have to register everything you use.
  register: [helloWorld, logMiddleware],
  dependencies: {
    helloWorld,
  },
  async init(_, deps) {
    await deps.helloWorld();
  },
});

run(app);
```

We have a circular dependency checker to ensure consistency. If a circular dependency is found, an error will be thrown, showing the exact paths involved.

Tasks, however, are not bound by this restriction; they can freely depend on each other as needed.

The dependencies get injected as follows:

| Component    | Injection Description                                     |
| ------------ | --------------------------------------------------------- |
| `tasks`      | Injected as functions with their input argument           |
| `resources`  | Injected as their return value                            |
| `events`     | Injected as functions with their payload argument         |
| `middleware` | Not typically injected; used via a `middleware: []` array |

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

There are only 2 recommended ways to listen to events:

### `task.on` property

```ts
import { task, run, event } from "@bluelibs/runner";

const afterRegisterEvent = event<{ userId: string }>({
  id: "app.user.afterRegister",
});

const helloTask = task({
  id: "app.hello",
  on: afterRegisterEvent,
  listenerPriority: 0, // this is the order in which the task will be executed when `on` is present
  run(event) {
    console.log("User has been registered!");
  },
});

const app = resource({
  id: "app",
  register: [afterRegisterEvent, helloTask],
  dependencies: {
    afterRegisterEvent,
  },
  async init(_, deps) {
    await deps.afterRegisterEvent({ userId: "XXX" });
  },
});
```

### `resource.hooks` property

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
      order: -1000, // event priority, the lower the number, the sooner it will run.
      async run(event, deps) {
        // both dependencies and event are properly infered through typescript
        console.log("User has been registered!");
      },
    },
  ],
  async init(_, deps) {
    await deps.afterRegisterEvent({ userId: "XXX" });
  },
});
```

#### wildcard events

You can listen to all events by using the wildcard `*`.

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
      event: "*",
      async run(event, deps) {
        console.log(
          "Generic event detected",
          event.id,
          event.data,
          event.timestamp
        );
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

### When to use either?

- `hooks` are for resources to extend each other, compose functionalities, they are mostly used for configuration and blending in the system.
- `on` is for when you want to perform a task when something happens, like send an email, begin processing something, etc.

## Middleware

Middleware intercepts the execution of tasks or the initialization of resources, providing a powerful means to enhance functionality. The order in which middleware is registered dictates its execution priority: the first middleware registered is the first to run, while the last middleware in the middleware array at the task level is the closest to the task itself, executing just before the task completes. (Imagine an onion if you will, with the task at the core.)

```ts
import { task, resource, run, event } from "@bluelibs/runner";

const logMiddleware = middleware({
  id: "app.middleware.log",
  dependencies: {
    // inject tasks, resources, eventCallers here.
  },
  async run(data, deps) {
    const { taskDefinition, resourceDefinition, config, next, input } = data;

    // The middleware can be for a task or a resource, depending on which you get the right elements.
    if (taskDefinition) {
      console.log("Before task", taskDefinition.id);
      const result = await next(input); // pass the input to the next middleware or task
      console.log("After task", taskDefinition.id);
    } else {
      console.log("Before resource", resourceDefinition.id);
      const result = await next(config); // pass the input to the next middleware or task
      console.log("After resource", resourceDefinition.id);
    }

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

### Global

If you want to register a middleware for all tasks and resources, here's how you can do it:

```ts
import { run, resource } from "@bluelibs/runner";

const logMiddleware = middleware({
  id: "app.middleware.log",
  // ... rest
});

const root = resource({
  id: "app",
  register: [logMiddleware.global() /* this will apply to all tasks */],
});
```

The middleware can only be registered once. This means that if you register a middleware as global, you cannot specify it as a task middleware. This is to avoid confusion and to keep the system clean.

## Errors

If an error is thrown in a task, the error will be propagated up to the top runner.

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

run(app).catch((err) => {
  console.error(err);
});
```

You can listen to errors via events:

```ts
const helloWorld = task({
  id: "app.tasks.helloWorld.onError",
  on: helloWorld.events.onError,
  run({ error, input, suppress }, deps) {
    // this will be called when an error happens

    // if you handled the error, and you don't want it propagated to the top, supress the propagation.
    suppress();
  },
});
```

```ts
const helloWorld = resource({
  id: "app.resources.helloWorld.onError",
  on: helloWorld.events.onError,
  init({ error, input, suppress }, deps) {
    // this will be called when an error happens

    // if you handled the error, and you don't want it propagated to the top, supress the propagation.
    suppress();
  },
});
```

## Meta

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

This is particularly helpful to use in conjunction with global middlewares, or global events, they can read some meta tag definition and act accordingly, decorate them or log them.

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

## Internal Services

We expose direct access to the following internal services:

- Store (contains Map()s for events, tasks, resources, middleware configurations)
- TaskRunner (can run tasks definitions directly and within D.I. context)
- EventManager (can emit and listen to events)

Attention, we do not encourage you to use these services directly, unless you really have to, they are exposed for advanced use-case scenarios.

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

Domain usually is "app", but as your application grows or you plan on building external libraries the naming convention should be: "companyName.packageName".

| Type           | Format                                    |
| -------------- | ----------------------------------------- |
| Tasks          | `{domain}.tasks.{taskName}`               |
| Listener Tasks | `{domain}.tasks.{taskName}.on{EventName}` |
| Resources      | `{domain}.resources.{resourceName}`       |
| Events         | `{domain}.events.{eventName}`             |
| Middleware     | `{domain}.middleware.{middlewareName}`    |

You can always create helpers for you as you're creating your tasks, resources, middleware:

```ts
function namespaced(id) {
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

## Real life

Or is it just fantasy?

Typically, an application consists of an Express server (to handle HTTP requests), a database, and various services. You can conveniently define all of these components within a single file and execute them together.

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

The system intelligently determines the order in which init() functions should be called, ensuring that all dependencies are initialized first. In the case of circular dependencies, it will throw an error, providing the exact paths to help identify the issue.

### Business config

Or just simple config, you can do it for your business logic, environment variables, etc.

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

## Global Events

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

### Resource level

```ts
import { task, run, event } from "@bluelibs/runner";

const businessData = {
  pricePerSubscription: 9.99,
};

const businessConfig = resource({
  id: "app.config",
  async init() {
    return businessData; // if you use it as a const you will have full typesafety
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

## Advanced Usage

This is just a "language" of developing applications. It simplifies dependency injection to the barebones, it forces you to think more functional and use classes less.

This doesn't mean you shouldn't use classes, just not for hooking things up together.

You can add many services or external things into the runner ecosystem with things like:

```ts
import { task, run, event } from "@bluelibs/runner";

// proxy declaration pattern
const expressResource = resource({
  id: "app.helloWorld",
  run: async (app: express.Application) => app,
});

const app = resource({
  id: "app",
  register: [expressResource.with(express())],
  dependencies: {
    express: expressResource,
  },
  init: async (_, { express }) => {
    express.get("/", (req, res) => {
      res.send("Hello World!");
    });
  },
});

run(app);
```

This demonstrates how effortlessly an external service can be encapsulated within the runner ecosystem. This ‘pattern’ of storing objects in this manner is quite unique, as it typically involves configurations with various options, rather than directly using an Express instance like this:

```ts
type Config = {
  port: number;
};

const expressResource = resource({
  id: "app.helloWorld",
  init: async (config: Config) => {
    const app = express();
    app.listen(config.port);
    return app;
  },
});

const app = resource({
  id: "app",
  register: [expressResource.with({ port: 3000 })],
  dependencies: {
    express: expressResource,
  },
  init: async (_, { express }) => {
    // type is automagically infered.
    express.get("/", (req, res) => {
      res.send("Hello World!");
    });
  },
});

run(app);
```

### Inter-communication between resources

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
      // careful when you listen on such events and need dependencies, you might not have them computed yet due to how early these events happen in the system.
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

Another approach is to create a new event that contains the configuration, providing the flexibility to update it as needed.

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
    Objecte.freeze(config);

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

### Overrides

Previously, we discussed how to extend functionality using events. However, there are times when you need to replace an existing resource with a new one or swap out a task or middleware imported from another package that doesn’t support such changes.

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

The new securityResource will replace the existing one, ensuring all future references point to the updated version.

Overrides work if the resource being overridden is already registered. If multiple resources attempt to override the same one, no error will be thrown. This is a common scenario, where the root resource typically contains the most authoritative overrides. But it's also to be mindful about.

## Logging

We expose through globals a `logger` that you can use to log things. Essentially what this service does it emits a `global.events.log` event with an `ILog` object.

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

Logs don't get printed by default. You have to set the print threshold to a certain level. This is useful when you want to print only errors and critical logs in production, but you want to print all logs in development. Your codebase, your rules.

To showcase the versatility of the system, here are some ways you could do it:

```ts
import { task, run, event, globals, resource } from "@bluelibs/runner";

const { logger } = globals.resources;

const printLog = task({
  id: "app.task.updatePrintThreshold",
  on: logger.events.afterInit,
  // Note: logger is
  run: async (event, deps) => {
    const logger = event.data.value;
    logger.setPrintThreshold("trace"); // will print all logs
    logger.setPrintThreshold("error"); // will print only "error" and "critical" logs
  },
});

const app = resource({
  id: "root",
  register: [printLog],
});

// Now your app will print all logs
```

You can also achieve this using hooks:

```ts
resource({
  id: "root",
  hooks: [
    {
      // after logger gets initialised as a resource, I'm going to set the print threshold
      event: logger.events.afterInit,
      async run(event) {
        const logger = event.data; // do not depend on the logger
        logger.setPrintThreshold("trace");
      },
    },
  ],
});
```

The logger’s log() function is asynchronous because it handles events. If you want to prevent your system from waiting for log operations to complete, simply omit the await when calling log(). This is useful if you have listeners that send logs to external log storage systems.

Additionally, there is a `global.events.log` event available. You can use this event both to emit log messages and to listen for all log activities.

```ts
import { task, run, event, globals } from "@bluelibs/runner";

const { logger } = globals.resources;

const shipLogsToWarehouse = task({
  id: "app.task.shipLogsToWarehouse",
  on: logger.events.log,
  dependencies: {
    warehouseService: warehouseServiceResource,
  },
  run: async (event, deps) => {
    const log = event.data; // ILog
    if (log.level === "error" || log.level === "critical") {
      // Ensure no extra log() calls are made here to prevent infinite loops
      await deps.warehouseService.push(log);
    }
  },
});
```

And yes, this would also work:

```ts
const task = task({
  id: "app.task.logSomething",
  dependencies: {
    log: globals.events.log,
  },
  run: async (_, { log }) => {
    await log({
      level: "info",
      data: { anything: "you want" };
      timestamp: new Date();
      context: "app.task.logSomething"; // optional
    })
  },
});
```

Fair Warning: If you plan to use the global.events.log event, ensure you avoid creating a circular dependency. This event is emitted by the logger itself. Additionally, some logs are sent before all resources are fully initialized. Therefore, it’s important to carefully review and verify your dependencies to prevent potential issues.

## Testing

Oh yes, testing is a breeze with this system. You can easily test your tasks, resources, and middleware by running them in a test environment. It's designed to be tested.

### Unit Testing

You can easily test your middleware, resources and tasks by running them in a test environment.

The only components you need to test are the run function and the init functions, along with their proper dependencies.

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

Unit testing becomes straightforward with mocks, as all dependencies are explicitly defined. However, if you wish to run an integration test, you can have a task tested within the full container environment.

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

Then your tests can now be cleaner, as you can use `overrides` and a wrapper resource to mock your task.

```ts
describe("app", () => {
  it("an example to override a task or resource", async () => {
    const testApp = resource({
      id: "app.test",
      register: [myApp], // wrap your existing app
      overrides: [override], // apply the overrides for "app.myTask"
      init: async (_, deps) => {
        // you can now test a task simply by depending on it, and running it, then asserting the response of run()
      },
    });

    await run(testApp);
  });
});
```

## Support

This package is part of the [BlueLibs](https://www.bluelibs.com) family. If you enjoy this work, please show your support by starring [the main repository](https://github.com/bluelibs/runner).

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
