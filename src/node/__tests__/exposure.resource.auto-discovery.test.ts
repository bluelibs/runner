import * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import { defineResource, defineTask, defineEvent } from "../../define";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("nodeExposure auto-discovery (server-mode http)", () => {
  type MockReq = Readable & IncomingMessage;
  type MockRes = ServerResponse;

  function makeReq(body: string, url: string): MockReq {
    const req = new Readable({ read() {} }) as MockReq;
    Object.assign(req, {
      aborted: false,
      httpVersion: "1.1",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      complete: true,
      rawHeaders: [] as string[],
      trailers: {} as Record<string, string>,
      rawTrailers: [] as string[],
      setTimeout(_msecs: number, _callback?: () => void) {
        return req;
      },
      socket: new Socket(),
    });
    req.method = "POST";
    req.url = url;
    req.headers = {
      "x-runner-token": "T",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body));
      req.push(null);
    });
    return req;
  }

  function makeRes(): MockRes {
    const res = {
      statusCode: 0,
      setHeader(
        _name: string,
        _value: number | string | ReadonlyArray<string>,
      ) {
        return res as unknown as ServerResponse;
      },
      end() {
        return res as unknown as ServerResponse;
      },
    } as unknown as MockRes;
    return res;
  }

  it("allows only server-tunnel-allowlisted ids and uses store.resources.get() values", async () => {
    const allowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto.disc.allowed",
      run: async ({ v }) => v,
    });
    const notAllowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto.disc.notAllowed",
      run: async ({ v }) => v,
    });
    const allowedEvent = defineEvent<{ n: number }>({
      id: "auto.disc.allowed.ev",
    });

    const srvTunnel = defineResource({
      id: "auto.disc.tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: [allowed.id],
        events: [allowedEvent.id],
      }),
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });

    const app = defineResource({
      id: "auto.disc.app",
      register: [srvTunnel, allowed, notAllowed, allowedEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const req = makeReq(body, `/__runner/task/${encodeURIComponent(allowed.id)}`);
      const res = makeRes();
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(200);
    }

    // Not allowed task -> 403 (forbidden when not allowlisted)
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const req = makeReq(
        body,
        `/__runner/task/${encodeURIComponent(notAllowed.id)}`,
      );
      const res = makeRes();
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(403);
    }

    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const req = makeReq(
        body,
        `/__runner/event/${encodeURIComponent(allowedEvent.id)}`,
      );
      const res = makeRes();
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(200);
    }

    await rr.dispose();
  });
});
