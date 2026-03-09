import {
  globalResources,
  health,
  serializer,
  store,
} from "../../globals/globalResources";

describe("globalResources named exports", () => {
  it("re-export store and serializer aliases directly", () => {
    expect(store).toBe(globalResources.store);
    expect(health).toBe(globalResources.health);
    expect(serializer).toBe(globalResources.serializer);
  });
});
