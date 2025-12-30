import { asyncContext } from "../../definers/builders/asyncContext";
import type { IDurableContext } from "./core/interfaces/context";

export const durableContext = asyncContext<IDurableContext>(
  "bluelibs.durable.context",
).build();
