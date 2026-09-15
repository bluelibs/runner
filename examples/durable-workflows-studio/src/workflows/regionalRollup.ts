import { Match, r } from "@bluelibs/runner";
import { durableWorkflowTag } from "@bluelibs/runner/node";
import { durable } from "../server/studioIds.js";

export interface RegionalRollupInput {
  region: string;
  batches: number;
  ordersPerBatch: number;
}

export interface RegionalRollupResult {
  region: string;
  batches: number;
  ordersProcessed: number;
}

export const regionalRollupInputSchema = Match.compile({
  region: Match.NonEmptyString,
  batches: Match.Range({ min: 1, max: 3, integer: true }),
  ordersPerBatch: Match.Range({ min: 1, integer: true }),
});

export const regionalRollup = r
  .task("regionalRollup")
  .inputSchema(regionalRollupInputSchema)
  .tags([
    durableWorkflowTag.with({
      key: "regionalRollup",
      category: "operations",
    }),
  ])
  .dependencies({ durable })
  .run(
    async (
      input: RegionalRollupInput,
      { durable },
    ): Promise<RegionalRollupResult> => {
      if (!input.region || input.batches < 1 || input.batches > 3) {
        throw new Error("Region is required and batches must be between 1 and 3.");
      }
      const durableContext = durable.use();
      let ordersProcessed = 0;

      for (let index = 0; index < input.batches; index += 1) {
        const batch = index + 1;
        ordersProcessed += await durableContext.step(
          `processBatch:${batch}`,
          async () => input.ordersPerBatch,
        );
        await durableContext.note(
          `${input.region} batch ${batch}/${input.batches} reconciled`,
          { batch, ordersProcessed },
        );
      }

      return {
        region: input.region,
        batches: input.batches,
        ordersProcessed,
      };
    },
  )
  .build();
