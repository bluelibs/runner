import { defineResource } from "../../define";
import {
  getResourcesInDisposeWaves,
  getResourcesInReadyWaves,
} from "../../models/utils/disposeOrder";
import { InitWave } from "../../types/storeTypes";
import { createTestFixture } from "../test-utils";

describe("disposeOrder waves", () => {
  it("reverses recorded init waves and preserves parallel waves", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const first = defineResource({ id: "dispose-waves-first" });
    const second = defineResource({ id: "dispose-waves-second" });
    const third = defineResource({ id: "dispose-waves-third" });
    const fourth = defineResource({ id: "dispose-waves-fourth" });

    for (const resource of [first, second, third, fourth]) {
      store.storeGenericItem(resource);
      store.resources.get(resource.id)!.isInitialized = true;
    }

    const waves: InitWave[] = [
      { resourceIds: [first.id], parallel: false },
      { resourceIds: [second.id, third.id], parallel: true },
      { resourceIds: [fourth.id], parallel: false },
    ];

    const result = getResourcesInDisposeWaves(store.resources, waves);
    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [fourth.id], parallel: false },
      { resourceIds: [second.id, third.id], parallel: true },
      { resourceIds: [first.id], parallel: false },
    ]);
  });

  it("falls back to sequential graph-based waves when recorded waves are incomplete", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const dep = defineResource({ id: "dispose-waves-fallback-dep" });
    const app = defineResource({
      id: "dispose-waves-fallback-app",
      dependencies: { dep },
    });

    store.storeGenericItem(dep);
    store.storeGenericItem(app);
    store.resources.get(dep.id)!.isInitialized = true;
    store.resources.get(app.id)!.isInitialized = true;

    const result = getResourcesInDisposeWaves(store.resources, [
      { resourceIds: [app.id], parallel: false },
    ]);

    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [app.id], parallel: false },
      { resourceIds: [dep.id], parallel: false },
    ]);
  });

  it("uses insertion-order LIFO sequential waves when a graph cycle is detected", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const aDeps: any = {};
    const bDeps: any = {};
    const a = defineResource({
      id: "dispose-waves-cycle-a",
      dependencies: () => aDeps,
    });
    const b = defineResource({
      id: "dispose-waves-cycle-b",
      dependencies: () => bDeps,
    });

    aDeps.b = b;
    bDeps.a = a;

    store.storeGenericItem(a);
    store.storeGenericItem(b);
    store.resources.get(a.id)!.isInitialized = true;
    store.resources.get(b.id)!.isInitialized = true;

    const result = getResourcesInDisposeWaves(store.resources, []);
    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [b.id], parallel: false },
      { resourceIds: [a.id], parallel: false },
    ]);
  });

  it("preserves tracked init waves for startup-ready ordering", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const first = defineResource({ id: "ready-waves-first" });
    const second = defineResource({ id: "ready-waves-second" });
    const third = defineResource({ id: "ready-waves-third" });

    for (const resource of [first, second, third]) {
      store.storeGenericItem(resource);
      store.resources.get(resource.id)!.isInitialized = true;
    }

    const waves: InitWave[] = [
      { resourceIds: [first.id], parallel: false },
      { resourceIds: [second.id, third.id], parallel: true },
    ];

    const result = getResourcesInReadyWaves(store.resources, waves);
    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [first.id], parallel: false },
      { resourceIds: [second.id, third.id], parallel: true },
    ]);
  });

  it("falls back to dependency-first ready ordering when tracked waves are incomplete", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const dep = defineResource({ id: "ready-waves-fallback-dep" });
    const app = defineResource({
      id: "ready-waves-fallback-app",
      dependencies: { dep },
    });

    store.storeGenericItem(dep);
    store.storeGenericItem(app);
    store.resources.get(dep.id)!.isInitialized = true;
    store.resources.get(app.id)!.isInitialized = true;

    const result = getResourcesInReadyWaves(store.resources, []);

    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [dep.id], parallel: false },
      { resourceIds: [app.id], parallel: false },
    ]);
  });

  it("falls back to insertion-order ready waves when a dependency cycle is detected", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const aDeps: any = {};
    const bDeps: any = {};
    const a = defineResource({
      id: "ready-waves-cycle-a",
      dependencies: () => aDeps,
    });
    const b = defineResource({
      id: "ready-waves-cycle-b",
      dependencies: () => bDeps,
    });

    aDeps.b = b;
    bDeps.a = a;

    store.storeGenericItem(a);
    store.storeGenericItem(b);
    store.resources.get(a.id)!.isInitialized = true;
    store.resources.get(b.id)!.isInitialized = true;

    const result = getResourcesInReadyWaves(store.resources, []);
    expect(
      result.map((wave) => ({
        resourceIds: wave.resources.map((resource) => resource.resource.id),
        parallel: wave.parallel,
      })),
    ).toEqual([
      { resourceIds: [a.id], parallel: false },
      { resourceIds: [b.id], parallel: false },
    ]);
  });
});
