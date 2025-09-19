jest.setTimeout(20000);

describe("examples/tunnels", () => {
  it("streaming-append example runs end-to-end", async () => {
    const mod = await import(
      "../../../examples/tunnels/streaming-append.example"
    );
    await expect(mod.runStreamingAppendExample()).resolves.toBeUndefined();
  });

  it("streaming-duplex example runs end-to-end", async () => {
    const mod = await import(
      "../../../examples/tunnels/streaming-duplex.example"
    );
    await expect(mod.runStreamingDuplexExample()).resolves.toBeUndefined();
  });
});
