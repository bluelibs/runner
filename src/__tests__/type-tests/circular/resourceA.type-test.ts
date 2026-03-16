import { r, RegisterableItem } from "../../../";
import { taskA } from "./taskA.type-test";

// This example demonstrates that a resource can register a task that depends on it
// Without performing meta gymanstics

export const resourceA = r
  .resource("resourceA")
  .register((): RegisterableItem[] => {
    return [taskA];
  })
  .build();
