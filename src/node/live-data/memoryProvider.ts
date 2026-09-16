import type { LiveDataProvider, LiveDataProviderEvent } from "./types";

type Registration = {
  topics: ReadonlySet<string>;
  listener: (event: LiveDataProviderEvent) => void;
};

/** Creates the isolated in-memory invalidation provider used by each runtime. */
export function createMemoryLiveDataProvider(): LiveDataProvider {
  const registrations = new Set<Registration>();

  return {
    connected: true,
    async publish(topicKeys) {
      const published = new Set(topicKeys);
      for (const registration of registrations) {
        if (!intersects(registration.topics, published)) continue;
        registration.listener({ type: "invalidate", topics: topicKeys });
      }
    },
    async subscribe(topicKeys, listener) {
      const registration: Registration = {
        topics: new Set(topicKeys),
        listener,
      };
      registrations.add(registration);
      return async () => {
        registrations.delete(registration);
      };
    },
    async dispose() {
      registrations.clear();
    },
  };
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}
