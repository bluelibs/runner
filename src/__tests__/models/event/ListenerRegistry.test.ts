import { ListenerRegistry, createListener } from "../../../models/event/ListenerRegistry";

describe("ListenerRegistry", () => {
  it("getListenersForEmit respects excludeFromGlobal hook", () => {
    const registry = new ListenerRegistry((event: any) => event.exclude === true);

    const eventId = "ev1";
    const globalListener = createListener({ handler: jest.fn(), order: 1, isGlobal: true });
    const specificListener = createListener({ handler: jest.fn(), order: 0 });

    registry.addListener(eventId, specificListener);
    registry.addGlobalListener(globalListener);

    const includeEvent = { id: eventId, exclude: false } as any;
    const excludeEvent = { id: eventId, exclude: true } as any;

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
    const registry = new ListenerRegistry((event: any) => event.exclude === true);
    const excludeEvent = { id: "ev-missing", exclude: true } as any;

    expect(registry.getListenersForEmit(excludeEvent)).toEqual([]);
  });

  it("exposes globalListenersCacheValid getter and toggles on invalidation", () => {
    const registry = new ListenerRegistry();
    expect(registry.globalListenersCacheValid).toBe(true);

    const globalListener = createListener({ handler: jest.fn(), order: 0, isGlobal: true });
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
});
