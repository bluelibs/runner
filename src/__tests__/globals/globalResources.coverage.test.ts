import {
  globalResources,
  serializer,
  store,
} from "../../globals/globalResources";

describe("globalResources named exports", () => {
  it("re-export store and serializer aliases directly", () => {
    expect(store).toBe(globalResources.store);
    expect(serializer).toBe(globalResources.serializer);
  });
});
