import {
  RedisLiveDataProvider,
  liveDataProviderResource,
  liveDataResource,
  redisLiveDataProviderResource,
  resources,
} from "../../node";
import { RedisMock } from "./redisProvider.test.utils";

describe("live data Node entrypoint", () => {
  it("exposes resource aliases with the same registration identity", () => {
    expect(liveDataResource).toBe(resources.liveData);
    expect(liveDataProviderResource).toBe(resources.liveDataProvider);
    expect(redisLiveDataProviderResource).toBe(resources.redisLiveDataProvider);
  });

  it("exposes a constructible Redis provider for custom resources", async () => {
    const publisher = new RedisMock();
    const subscriber = new RedisMock();
    publisher.duplicateResult = subscriber;
    const provider = new RedisLiveDataProvider({
      redis: publisher,
      prefix: "public-live-data",
    });

    try {
      await provider.publish(["topic"]);
      expect(publisher.published).toHaveLength(1);
    } finally {
      await provider.dispose();
    }
    expect(subscriber.quitCalls).toBe(1);
    expect(publisher.quitCalls).toBe(0);
  });
});
