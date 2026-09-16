import { Match, r } from "@bluelibs/runner";
import { durableWorkflowTag } from "@bluelibs/runner/node";
import { durable } from "../server/studioIds.js";
import {
  regionalRollup,
  type RegionalRollupResult,
} from "./regionalRollup.js";

const REGIONS = ["eu", "us", "apac"] as const;

export interface PortfolioReconciliationInput {
  portfolioId: string;
  ordersPerBatch: number;
}

export interface PortfolioReconciliationResult {
  portfolioId: string;
  children: Array<{ executionId: string; result: RegionalRollupResult }>;
  ordersProcessed: number;
}

export const portfolioReconciliationInputSchema = Match.compile({
  portfolioId: Match.NonEmptyString,
  ordersPerBatch: Match.Range({ min: 1, integer: true }),
});

export const portfolioReconciliation = r
  .task("portfolioReconciliation")
  .inputSchema(portfolioReconciliationInputSchema)
  .tags([
    durableWorkflowTag.with({
      key: "portfolioReconciliation",
      category: "operations",
    }),
  ])
  .dependencies({ durable })
  .run(
    async (
      input: PortfolioReconciliationInput,
      { durable },
    ): Promise<PortfolioReconciliationResult> => {
      if (!input.portfolioId || input.ordersPerBatch < 1) {
        throw new Error("Portfolio id and a positive batch size are required.");
      }
      const durableContext = durable.use();
      await durableContext.step("planPortfolio", async () => ({
        portfolioId: input.portfolioId,
        regions: REGIONS,
      }));

      const childIds: Array<{ region: (typeof REGIONS)[number]; id: string }> = [];
      for (const region of REGIONS) {
        const id = await durableContext.workflow(
          `spawn:${region}`,
          regionalRollup,
          { region, batches: 3, ordersPerBatch: input.ordersPerBatch },
        );
        childIds.push({ region, id });
      }

      const children: PortfolioReconciliationResult["children"] = [];
      for (const child of childIds) {
        const result = await durableContext.waitForExecution(
          regionalRollup,
          child.id,
          { stepId: `join:${child.region}` },
        );
        children.push({ executionId: child.id, result });
      }

      const ordersProcessed = children.reduce(
        (total, child) => total + child.result.ordersProcessed,
        0,
      );
      await durableContext.step("publishPortfolio", async () => ({
        portfolioId: input.portfolioId,
        ordersProcessed,
      }));

      return { portfolioId: input.portfolioId, children, ordersProcessed };
    },
  )
  .build();
