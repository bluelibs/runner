import { generateKeyPairSync } from "node:crypto";
import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalTags } from "../../../globals/globalTags";
import { eventLanesResource } from "../../event-lanes";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { r } from "../../../public";

function createAsymmetricKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

describe("eventLanes auth in network mode", () => {
  it("fails fast for producer-only profile when signer material is missing", async () => {
    const keys = createAsymmetricKeys();
    const lane = r.eventLane("tests-event-lanes-auth-network-producer").build();
    const event = defineEvent({
      id: "tests-event-lanes-auth-network-producer-event",
      tags: [globalTags.eventLane.with({ lane })],
    });
    const topology = {
      profiles: {
        producer: { consume: [] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: {
            mode: "jwt_asymmetric" as const,
            publicKey: keys.publicKey,
          },
        },
      ],
    } as const;
    const app = defineResource({
      id: "tests-event-lanes-auth-network-producer-app",
      register: [
        event,
        eventLanesResource.with({
          profile: "producer",
          topology,
          mode: "network",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.remoteLanes.auth.signerMissing",
    });
  });

  it("fails fast for consumer profile when verifier material is missing", async () => {
    const keys = createAsymmetricKeys();
    const lane = r.eventLane("tests-event-lanes-auth-network-consumer").build();
    const event = defineEvent({
      id: "tests-event-lanes-auth-network-consumer-event",
      tags: [globalTags.eventLane.with({ lane })],
    });
    const topology = {
      profiles: {
        worker: { consume: [lane] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: {
            mode: "jwt_asymmetric" as const,
            privateKey: keys.privateKey,
          },
        },
      ],
    } as const;
    const app = defineResource({
      id: "tests-event-lanes-auth-network-consumer-app",
      register: [
        event,
        eventLanesResource.with({
          profile: "worker",
          topology,
          mode: "network",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.remoteLanes.auth.verifierMissing",
    });
  });

  it("allows consumer-only profile to start with public-key verifier only", async () => {
    const keys = createAsymmetricKeys();
    const lane = r
      .eventLane("tests-event-lanes-auth-network-consumer-public-only")
      .build();
    const event = defineEvent({
      id: "tests-event-lanes-auth-network-consumer-public-only-event",
      tags: [globalTags.eventLane.with({ lane })],
    });
    const topology = {
      profiles: {
        worker: { consume: [lane] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: {
            mode: "jwt_asymmetric" as const,
            publicKey: keys.publicKey,
          },
        },
      ],
    } as const;
    const app = defineResource({
      id: "tests-event-lanes-auth-network-consumer-public-only-app",
      register: [
        event,
        eventLanesResource.with({
          profile: "worker",
          topology,
          mode: "network",
        }),
      ],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("denies producer path on consumer profile that only has public verifier material", async () => {
    const keys = createAsymmetricKeys();
    const lane = r
      .eventLane("tests-event-lanes-auth-network-consumer-public-only-produce")
      .build();
    const event = defineEvent({
      id: "tests-event-lanes-auth-network-consumer-public-only-produce-event",
      tags: [globalTags.eventLane.with({ lane })],
    });
    const emitTask = defineTask({
      id: "tests-event-lanes-auth-network-consumer-public-only-produce-task",
      dependencies: { event },
      run: async (_input, deps) => {
        await deps.event({});
      },
    });
    const topology = {
      profiles: {
        worker: { consume: [lane] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: {
            mode: "jwt_asymmetric" as const,
            publicKey: keys.publicKey,
          },
        },
      ],
    } as const;
    const app = defineResource({
      id: "tests-event-lanes-auth-network-consumer-public-only-produce-app",
      register: [
        event,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology,
          mode: "network",
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(emitTask as any)).rejects.toMatchObject({
      name: "runner.errors.remoteLanes.auth.signerMissing",
    });
    await runtime.dispose();
  });
});
