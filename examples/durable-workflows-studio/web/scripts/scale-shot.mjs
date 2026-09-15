import assert from "node:assert/strict";
import { join } from "node:path";
import { bootStudio } from "../../dist/server/studioApp.js";
import { createStudioServer } from "../../dist/server/http.js";
import { WORKFLOWS } from "../../dist/workflows/catalog.js";

/** Inspection-only fixtures: real indexed storage/API, not 100k browser-side simulations. */
export async function captureScaleShots(page, shotsDir) {
  const handles = await bootStudio();
  const originalSnapshot = handles.store.exportSnapshot();
  const originalCatalogSize = WORKFLOWS.length;
  const server = createStudioServer(handles);
  const responseChecks = [];
  let executionRequests = 0;
  const checkResponse = (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/executions") {
      executionRequests++;
      responseChecks.push(
        response.json().then((body) => {
          assert.ok(body.executions.length <= 40);
          for (const execution of body.executions)
            assert.equal("input" in execution, false);
        }),
      );
    }
    if (url.pathname === "/api/workflows")
      responseChecks.push(
        response.json().then((body) => assert.ok(body.workflows.length <= 20)),
      );
  };
  try {
    for (let index = 0; index < 45; index++)
      WORKFLOWS.push({
        ...WORKFLOWS[0],
        key: `scaleType${index}`,
        title: `Scale workflow ${index}`,
        category: "scale fixture",
      });
    const now = Date.now();
    for (let index = 0; index < 100000; index++)
      await handles.store.saveExecution({
        id: `scale-${String(index).padStart(6, "0")}`,
        workflowKey: WORKFLOWS[index % 50].key,
        status: index >= 99980 ? "running" : "completed",
        input: { fixture: true },
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(now - (100000 - index) * 1000),
        updatedAt: new Date(now - (100000 - index) * 1000),
        ...(index < 99980
          ? { completedAt: new Date(now - (100000 - index) * 1000 + 500) }
          : {}),
      });
    for (const node of WORKFLOWS[0].graph.nodes)
      await handles.store.saveStepResult({
        executionId: "scale-000000",
        stepId: node.id,
        result: { fixture: true },
        completedAt: new Date(now - 99999500),
      });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    page.on("response", checkResponse);
    await page.goto(`${url}?view=executions`, { waitUntil: "networkidle" });
    await page.locator(".exec-row").first().waitFor();
    const statAlignment = await page
      .locator(".side-stats .stat")
      .evaluateAll((stats) =>
        stats.map((stat) =>
          Math.abs(
            stat.querySelector(".stat-num").getBoundingClientRect().left -
              stat.querySelector(".stat-label").getBoundingClientRect().left,
          ),
        ),
      );
    assert.equal(statAlignment.length, 3);
    assert.ok(statAlignment.every((difference) => difference < 1));
    for (let index = 0; index < 14; index++) {
      await page.locator(".exec-scroll").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.waitForTimeout(150);
      assert.ok((await page.locator(".exec-row").count()) <= 40);
    }
    await page
      .getByRole("button", { name: "Load newer runs", exact: true })
      .waitFor();
    assert.ok(executionRequests >= 11 && executionRequests < 30);
    await page.screenshot({ path: join(shotsDir, "19-live-100k-history.png") });
    await page
      .getByPlaceholder("Execution ID (exact)…  ( / )")
      .fill("scale-000000");
    await page.waitForFunction(
      () => document.querySelectorAll(".exec-row").length === 1,
    );
    await page.locator(".exec-row").click();
    await page.getByRole("heading", { name: "Order processing" }).waitFor();
    await page.screenshot({ path: join(shotsDir, "20-live-100k-oldest.png") });
    await Promise.all(responseChecks);
    console.log(
      `100k live check: ${executionRequests} bounded execution requests; <=40 mounted rows; oldest ID found; saved shots 19 and 20`,
    );
  } finally {
    page.off("response", checkResponse);
    try {
      await page.goto("about:blank");
    } finally {
      // Browser failures must not strand the server or its scale fixture.
      server.closeAllConnections();
      try {
        if (server.listening)
          await new Promise((resolve) => server.close(resolve));
      } finally {
        WORKFLOWS.length = originalCatalogSize;
        try {
          await handles.dispose();
        } finally {
          handles.store.restoreSnapshot(originalSnapshot);
          assert.deepEqual(handles.store.exportSnapshot(), originalSnapshot);
          console.log(
            "Scale fixture cleared; original store and catalog restored.",
          );
        }
      }
    }
  }
}
