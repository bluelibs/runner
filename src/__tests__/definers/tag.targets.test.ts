import { tag as defineTag, r } from "../..";
import {
  assertTagTargetsApplicable,
  assertTagTargetsApplicableTo,
} from "../../definers/assertTagTargetsApplicable";
import { tagTargetNotAllowedError } from "../../errors";

describe("tag target scopes", () => {
  it("stores targets on built tags and preserves them on configured tags", () => {
    const taskTag = r
      .tag<{ label: string }>("tests.tag.targets.taskOnly")
      .for(["tasks"])
      .build();
    const resourceTag = r
      .tag("tests.tag.targets.resourceOnly")
      .for("resources")
      .build();

    expect(taskTag.targets).toEqual(["tasks"]);
    expect(Object.isFrozen(taskTag.targets)).toBe(true);
    expect(resourceTag.targets).toEqual(["resources"]);
    expect(Object.isFrozen(resourceTag.targets)).toBe(true);

    const configured = taskTag.with({ label: "x" });
    expect(configured.targets).toEqual(["tasks"]);
    expect(Object.isFrozen(configured.targets)).toBe(true);
  });

  it("fails fast when a scoped tag is attached to the wrong definition kind", () => {
    const taskOnlyTag = r
      .tag("tests.tag.targets.integration.taskOnly")
      .for(["tasks"])
      .build();

    expect(() =>
      r
        .resource("tests.tag.targets.integration.resource")
        .tags([taskOnlyTag as never])
        .build(),
    ).toThrow(/Allowed targets: tasks/);
  });

  it("validates error tags too (defineError path)", () => {
    const eventOnlyTag = defineTag({
      id: "tests.tag.targets.error.eventOnly",
      targets: ["events"] as const,
    });

    let thrown: unknown;
    try {
      r.error("tests.tag.targets.error.helper")
        .format(() => "nope")
        .tags([eventOnlyTag as never])
        .build();
    } catch (error) {
      thrown = error;
    }

    expect(tagTargetNotAllowedError.is(thrown)).toBe(true);
    expect((thrown as Error).message).toContain("Remediation:");
  });

  it("covers helper branches and wrapper", () => {
    expect(() =>
      assertTagTargetsApplicable({
        definitionType: "Task",
        definitionId: "tests.tag.targets.helper.none",
        target: "tasks",
        tags: undefined,
      }),
    ).not.toThrow();
    expect(() =>
      assertTagTargetsApplicable({
        definitionType: "Task",
        definitionId: "tests.tag.targets.helper.empty",
        target: "tasks",
        tags: [],
      }),
    ).not.toThrow();

    const taskTag = defineTag({
      id: "tests.tag.targets.helper.task",
      targets: ["tasks"] as const,
    });

    expect(() =>
      assertTagTargetsApplicableTo(
        "tasks",
        "Task",
        "tests.tag.targets.helper.wrapper",
        [taskTag],
      ),
    ).not.toThrow();

    expect(() =>
      assertTagTargetsApplicable({
        definitionType: "Task",
        definitionId: "tests.tag.targets.helper.skip",
        target: "tasks",
        tags: [
          123,
          { id: "no.targets" },
          { id: "mixed.targets", targets: ["tasks", 1] },
          { id: "bad.targets", targets: 1 },
        ],
      }),
    ).toThrow(/Allowed targets:/);

    expect(() =>
      assertTagTargetsApplicable({
        definitionType: "Task",
        definitionId: "tests.tag.targets.helper.unknown",
        target: "tasks",
        tags: [{ targets: ["resources"] }],
      }),
    ).toThrow(/<unknown-tag>/);
  });
});
