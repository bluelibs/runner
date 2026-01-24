import {
  startExposureServer,
  testTask,
  TOKEN,
  request,
} from "./resource.unit.test.utils";

const D = process.env.RUNNER_TEST_NET === "1" ? describe : describe.skip;

D("nodeExposure - unit multipart", () => {
  it("multipart: returns 400 INVALID_MULTIPART on bad __manifest JSON", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary123";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{bad\r\n--${boundary}--\r\n`,
    ].join("");

    const res = await request({
      method: "POST",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: {
        "x-runner-token": TOKEN,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    });

    expect(res.status).toBe(400);
    const json = JSON.parse(res.text);
    expect(json?.error?.code).toBe("INVALID_MULTIPART");
    await rr.dispose();
  });

  it("multipart: returns 400 MISSING_MANIFEST when __manifest is omitted", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary456";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file:F1"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\nabc\r\n--${boundary}--\r\n`,
    ].join("");

    const res = await request({
      method: "POST",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: {
        "x-runner-token": TOKEN,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    });

    expect(res.status).toBe(400);
    const json = JSON.parse(res.text);
    expect(json?.error?.code).toBe("MISSING_MANIFEST");
    await rr.dispose();
  });

  it("multipart: returns 500 when manifest references missing file part", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary789";
    const badId = "F1";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n` +
        JSON.stringify({
          input: {
            file: { $runnerFile: "File", id: badId, meta: { name: "x.txt" } },
          },
        }) +
        "\r\n" +
        `--${boundary}\r\nContent-Disposition: form-data; name="file:OTHER"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\nabc\r\n--${boundary}--\r\n`,
    ].join("");

    const res = await request({
      method: "POST",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: {
        "x-runner-token": TOKEN,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    });

    expect(res.status).toBe(500);
    expect(res.text).toContain("error");
    await rr.dispose();
  });
});
