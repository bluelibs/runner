import { EventManager } from "../EventManager";
import { Store } from "../Store";
import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";

describe("Store", () => {
  let store: Store;
  let eventManager: EventManager;

  beforeEach(() => {
    eventManager = new EventManager();
    store = new Store(eventManager);
  });

  it("should register an task", () => {
    const task = defineTask({
      id: "testTask",
      run: async () => {},
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [task],
      })
    );

    expect(store.tasks.get("testTask")).toBeDefined();
    expect(store.tasks.get("testTask")?.task).toBe(task);
  });

  it("should register a resource", () => {
    const resource = defineResource({
      id: "testResource",
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [resource],
      })
    );

    expect(store.resources.get("testResource")).toBeDefined();
    expect(store.resources.get("testResource")?.resource).toBe(resource);
  });

  it("should register an event", () => {
    const event = defineEvent({
      id: "testEvent",
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [event],
      })
    );

    expect(store.events.get("testEvent")).toBeDefined();
    expect(store.events.get("testEvent")?.event).toBe(event);
  });

  it("should register a middleware", () => {
    const middleware = defineMiddleware({
      id: "testMiddleware",
      run: async () => {},
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [middleware],
      })
    );

    expect(store.middlewares.get("testMiddleware")).toBeDefined();
    expect(store.middlewares.get("testMiddleware")?.middleware).toBe(
      middleware
    );
  });

  it("should throw an error when registering duplicate items", () => {
    const task = defineTask({
      id: "duplicateItem",
      run: async () => {},
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [task],
      })
    );

    expect(() => {
      store.computeRegisterOfResource(
        defineResource({
          id: "anotherRoot",
          register: [task],
        })
      );
    }).toThrow('Task "duplicateItem" already registered');
  });

  it("should return dependent nodes", () => {
    const task1 = defineTask({
      id: "task1",
      dependencies: { dep1: {} as any },
      run: async () => {},
    });

    const task2 = defineTask({
      id: "task2",
      dependencies: { dep2: {} as any },
      run: async () => {},
    });

    store.computeRegisterOfResource(
      defineResource({
        id: "root",
        register: [task1, task2],
      })
    );

    const dependentNodes = store.getDependentNodes();

    // global store, global event manager
    expect(dependentNodes).toHaveLength(2);
    expect(dependentNodes).toContainEqual({
      id: "task1",
      dependencies: { dep1: {} },
    });
    expect(dependentNodes).toContainEqual({
      id: "task2",
      dependencies: { dep2: {} },
    });
  });
});
