import * as Benchmark from "benchmark";
import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../../define";
import { run } from "../../run";

describe("Benchmarks", () => {
  let suite: Benchmark.Suite;

  beforeEach(() => {
    suite = new Benchmark.Suite();
  });

  it("should benchmark task execution", (done) => {
    const testTask = defineTask({
      id: "test.task",
      run: async () => "Hello, World!",
    });

    const app = defineResource({
      id: "app",
      dependencies: { testTask },
      register: [testTask],
      async init(_, { testTask }) {
        await testTask();
      },
    });

    suite.add("Task Execution", {
      defer: true,
      fn: (deferred: { resolve: () => void }) => {
        run(app).then(() => deferred.resolve());
      },
    });

    suite.on("complete", function () {
      console.log("Task Execution:", this[0].hz.toFixed(2), "ops/sec");
      done();
    });

    suite.run({ async: true });
  });

  it("should benchmark resource initialization", (done) => {
    const testResource = defineResource({
      id: "test.resource",
      init: async () => "Resource Value",
    });

    const app = defineResource({
      id: "app",
      register: [testResource],
      dependencies: { testResource },
      async init(_, { testResource }) {
        expect(testResource).toBe("Resource Value");
      },
    });

    suite.add("Resource Initialization", {
      defer: true,
      fn: (deferred: { resolve: () => void }) => {
        run(app).then(() => deferred.resolve());
      },
    });

    suite.on("complete", function () {
      console.log("Resource Initialization:", this[0].hz.toFixed(2), "ops/sec");
      done();
    });

    suite.run({ async: true });
  });

  it("should benchmark event emission", (done) => {
    const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
    const eventHandler = jest.fn();

    const handlerTask = defineTask({
      id: "handler.task",
      on: testEvent,
      run: async ({ data }) => {
        eventHandler(data.message);
      },
    });

    const app = defineResource({
      id: "app",
      register: [testEvent, handlerTask],
      dependencies: { testEvent },
      async init(_, { testEvent }) {
        await testEvent({ message: "Event emitted" });
      },
    });

    suite.add("Event Emission", {
      defer: true,
      fn: (deferred: { resolve: () => void }) => {
        run(app).then(() => deferred.resolve());
      },
    });

    suite.on("complete", function () {
      console.log("Event Emission:", this[0].hz.toFixed(2), "ops/sec");
      done();
    });

    suite.run({ async: true });
  });

  it("should benchmark dependency resolution", (done) => {
    const dep1 = defineResource({
      id: "dep1",
      init: async () => "Dep1 Value",
    });

    const dep2 = defineResource({
      id: "dep2",
      dependencies: { dep1 },
      init: async (_, { dep1 }) => `Dep2 Value: ${dep1}`,
    });

    const app = defineResource({
      id: "app",
      register: [dep1, dep2],
      dependencies: { dep2 },
      async init(_, { dep2 }) {
        expect(dep2).toBe("Dep2 Value: Dep1 Value");
      },
    });

    suite.add("Dependency Resolution", {
      defer: true,
      fn: (deferred: { resolve: () => void }) => {
        run(app).then(() => deferred.resolve());
      },
    });

    suite.on("complete", function () {
      console.log("Dependency Resolution:", this[0].hz.toFixed(2), "ops/sec");
      done();
    });

    suite.run({ async: true });
  });
});
