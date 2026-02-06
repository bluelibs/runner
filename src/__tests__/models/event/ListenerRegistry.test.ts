import { IEvent } from "../../../defs";
import { defineEvent } from "../../../definers/defineEvent";
import {
  ListenerRegistry,
  createListener,
} from "../../../models/event/ListenerRegistry";

interface TestEvent {
  id: string;
  exclude: boolean;
}

const createTestEvent = (
  id: string,
  exclude: boolean,
): TestEvent & ReturnType<typeof defineEvent> => {
  return Object.assign(defineEvent({ id }), { exclude });
};

describe("ListenerRegistry", () => {
  it("getListenersForEmit respects excludeFromGlobal hook", () => {
    const registry = new ListenerRegistry(
      (event: IEvent<any> & Partial<TestEvent>) => event.exclude === true,
    );

    const eventId = "ev1";
    const globalListener = createListener({
      handler: jest.fn(),
      order: 1,
      isGlobal: true,
    });
    const specificListener = createListener({ handler: jest.fn(), order: 0 });

    registry.addListener(eventId, specificListener);
    registry.addGlobalListener(globalListener);

    const includeEvent = createTestEvent(eventId, false);
    const excludeEvent = createTestEvent(eventId, true);

    // include path merges specific + global
    expect(registry.getListenersForEmit(includeEvent)).toEqual([
      specificListener,
      globalListener,
    ]);

    // exclude path ignores global listeners
    expect(registry.getListenersForEmit(excludeEvent)).toEqual([
      specificListener,
    ]);
  });

  it("getListenersForEmit returns [] when excluded and no event listeners", () => {
    const registry = new ListenerRegistry(
      (event: IEvent<any> & Partial<TestEvent>) => event.exclude === true,
    );
    const excludeEvent = createTestEvent("ev-missing", true);

    expect(registry.getListenersForEmit(excludeEvent)).toEqual([]);
  });

  it("exposes globalListenersCacheValid getter and toggles on invalidation", () => {
    const registry = new ListenerRegistry();
    expect(registry.globalListenersCacheValid).toBe(true);

    const globalListener = createListener({
      handler: jest.fn(),
      order: 0,
      isGlobal: true,
    });
    registry.addGlobalListener(globalListener);

    expect(registry.globalListenersCacheValid).toBe(false);
    // trigger cache rebuild to flip back to true
    registry.getCachedMergedListeners("any");
    expect(registry.globalListenersCacheValid).toBe(true);
  });

  it("createListener defaults isGlobal to false", () => {
    const listener = createListener({ handler: jest.fn(), order: 0 });
    expect(listener.isGlobal).toBe(false);
  });

  it("mergeSortedListeners keeps remaining listeners from either side", () => {
    const registry = new (ListenerRegistry as any)();
    const l1 = { priority: 10, handler: () => {} };
    const l2 = { priority: 5, handler: () => {} };

    const mergedLeft = registry.mergeSortedListeners([l1, l2], []);
    expect(mergedLeft).toHaveLength(2);
    expect(mergedLeft[0]).toBe(l1);
    expect(mergedLeft[1]).toBe(l2);

    const mergedRight = registry.mergeSortedListeners([], [l1, l2]);
    expect(mergedRight).toHaveLength(2);
    expect(mergedRight[0]).toBe(l1);
    expect(mergedRight[1]).toBe(l2);
  });
});
