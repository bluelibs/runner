import {
  globalResources,
  health,
  serializer,
  store,
  timers,
} from "../../globals/globalResources";

describe("globalResources named exports", () => {
  it("re-export store and serializer aliases directly", () => {
    expect(store).toBe(globalResources.store);
    expect(health).toBe(globalResources.health);
    expect(serializer).toBe(globalResources.serializer);
    expect(timers).toBe(globalResources.timers);
  });
});
