import { createMockReqRes } from "./resource.http.testkit";

export function createReqRes(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  manualPush?: boolean;
}) {
  return createMockReqRes({
    method: init.method,
    url: init.url,
    headers: init.headers,
    body: init.body,
    manualPush: init.manualPush,
  });
}
