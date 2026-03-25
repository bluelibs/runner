import {
  getCurrentRuntimeCallSource,
  runWithRuntimeCallSource,
} from "../../models/RuntimeCallSourceStore";
import { runtimeSource } from "../../types/runtimeSource";

describe("RuntimeCallSourceStore", () => {
  it("exposes the current runtime call source inside the active scope", () => {
    const source = runtimeSource.task("tests-source");

    runWithRuntimeCallSource(source, () => {
      expect(getCurrentRuntimeCallSource()).toEqual(source);
    });

    expect(getCurrentRuntimeCallSource()).toBeUndefined();
  });

  it("restores the parent source after nested scopes finish", () => {
    const outerSource = runtimeSource.task("tests-outer");
    const innerSource = runtimeSource.hook("tests-inner");

    runWithRuntimeCallSource(outerSource, () => {
      expect(getCurrentRuntimeCallSource()).toEqual(outerSource);

      runWithRuntimeCallSource(innerSource, () => {
        expect(getCurrentRuntimeCallSource()).toEqual(innerSource);
      });

      expect(getCurrentRuntimeCallSource()).toEqual(outerSource);
    });
  });
});
