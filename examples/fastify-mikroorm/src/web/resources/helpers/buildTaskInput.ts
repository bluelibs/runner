import { HttpInputFrom } from "./types";

export function buildTaskInput(request: any, mode: HttpInputFrom | undefined) {
  const m = mode || "body";
  if (m === "merged") {
    return {
      ...(request.params || {}),
      ...(request.query || {}),
      ...(request.body || {}),
    };
  }
  return request.body as any;
}
