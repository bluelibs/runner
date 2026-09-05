describe("defineError standalone", () => {
  it("reports invalid ids before foundation errors register", async () => {
    jest.resetModules();
    const { defineError, RunnerError } =
      await import("../../definers/defineError");

    let thrown: unknown;
    try {
      defineError({ id: "" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerError);
    expect(thrown).toHaveProperty("id", "validation");
  });

  it("reports invalid builder HTTP codes before domain errors register", async () => {
    jest.resetModules();
    const { makeErrorBuilder } =
      await import("../../definers/builders/error/fluent-builder");
    const { RunnerError } = await import("../../definers/defineError");

    let thrown: unknown;
    try {
      makeErrorBuilder({
        id: "tests-errors-standalone-http-code",
        filePath: __filename,
      }).httpCode(99);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerError);
    expect(thrown).toHaveProperty("id", "builder-invalidHttpCode");
  });

  it("reports incompatible tags before foundation errors register", async () => {
    jest.resetModules();
    const { defineError, RunnerError } =
      await import("../../definers/defineError");

    expect.assertions(3);
    try {
      defineError({
        id: "tests-errors-standalone-tag-target",
        tags: [
          {
            id: "tests-errors-standalone-task-tag",
            targets: ["tasks"],
          } as never,
        ],
      });
      fail("Expected incompatible tag target to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
      if (!(error instanceof RunnerError)) {
        throw error;
      }
      expect(error.id).toBe("tagTargetNotAllowed");
      expect(error.message).toContain("Allowed targets: tasks");
    }
  });
});
