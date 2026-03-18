import { runtimeAccessViolationError } from "../../errors";

describe("runtimeAccessViolationError remediation", () => {
  it("describes missing root exports declarations accurately", () => {
    const error = runtimeAccessViolationError.new({
      targetId: "secret.task",
      targetType: "Task",
      rootId: "app.root",
      exportedIds: [],
      exportsDeclared: false,
    });

    expect(String(error.remediation)).toContain(
      'Root "app.root" does not declare any exports.',
    );
  });

  it("describes explicit empty exports accurately", () => {
    const error = runtimeAccessViolationError.new({
      targetId: "secret.task",
      targetType: "Task",
      rootId: "app.root",
      exportedIds: [],
      exportsDeclared: true,
    });

    expect(String(error.remediation)).toContain(
      'Root "app.root" declares exports but currently exports none.',
    );
  });
});
