import { live, Match, r, resources } from "../../../../node";
import type {
  ExtractResourceValue,
  ExtractTaskInput,
  ResolveTaskOutput,
} from "../../../../defs";
import type { LiveSubscription } from "../../../live-data/types";

type Assert<T extends true> = T;
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;

void (async () => {
  const read = r
    .task("types-live-read")
    .inputSchema({ customerId: Match.NonEmptyString })
    .run(async ({ customerId }) => ({ customerId, paid: true as const }))
    .build();
  const query = live.query({
    task: read,
    topics: ({ customerId }) => live.topic("customer", customerId),
  });

  type Input = Assert<
    Equal<ExtractTaskInput<typeof query.task>, { customerId: string }>
  >;
  type Output = Assert<
    Equal<
      ResolveTaskOutput<typeof query.task>,
      { customerId: string; paid: true }
    >
  >;
  const input: Input = true;
  const output: Output = true;
  void [input, output];

  const liveData = null as unknown as ExtractResourceValue<
    typeof resources.liveData
  >;
  const subscription: LiveSubscription<{
    customerId: string;
    paid: true;
  }> = await liveData.subscribe(query, { customerId: "customer-1" });
  void subscription;

  // @ts-expect-error query input requires customerId
  await liveData.subscribe(query, {});
  // @ts-expect-error query input customerId is a string
  await liveData.subscribe(query, { customerId: 123 });
})();
