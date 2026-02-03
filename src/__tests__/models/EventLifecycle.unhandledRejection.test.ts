import { Queue, Semaphore } from "../..";

const flushUnhandledRejections = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("Event lifecycle emissions", () => {
  it("does not trigger an unhandledRejection when a Queue listener throws", async () => {
    const seenUnhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      seenUnhandledRejections.push(reason);
    };

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const q = new Queue();

      q.on("finish", () => {
        throw new Error();
      });

      await expect(q.run(async () => "ok")).resolves.toBe("ok");

      await flushUnhandledRejections();
      expect(seenUnhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("does not trigger an unhandledRejection when a Semaphore listener throws", async () => {
    const seenUnhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      seenUnhandledRejections.push(reason);
    };

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const semaphore = new Semaphore(1);

      semaphore.on("acquired", () => {
        throw new Error();
      });

      await expect(semaphore.acquire()).resolves.toBeUndefined();

      await flushUnhandledRejections();
      expect(seenUnhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
