import { r } from "../../../";
import { resourceA } from "./resourceA.type-test";

export const taskA = r
  .task("taskA")
  .dependencies(() => {
    return { resourceA };
  })
  .run(async (_, { resourceA }) => {
    void resourceA;
    return "hello";
  })
  .build();

export const taskB = r
  .task("taskB")
  .run(async () => {
    return "world";
  })
  .build();
