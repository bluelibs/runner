import type { IncomingMessage, ServerResponse } from "http";

import { Logger } from "../../../models/Logger";
import type { Store } from "../../../models/Store";
import { getDefaultSerializer } from "../../../serializer";
import {
  ExposureErrorLogKey,
  handleRequestError,
  sanitizeErrorResponse,
} from "../../exposure/handlers/errorHandlers";

enum ErrorCode {
  Bad = "BAD",
  Internal = "INTERNAL_ERROR",
}

enum ErrorMessage {
  Bad = "Bad",
  Internal = "Internal Error",
}

enum ErrorField {
  Stack = "stack",
  Cause = "cause",
  Sql = "sql",
}

describe("errorHandlers", () => {
  const getErrorRecord = (
    body: unknown,
  ): Record<string, unknown> | undefined => {
    if (!body || typeof body !== "object") return undefined;
    const error = (body as { error?: unknown }).error;
    if (!error || typeof error !== "object") return undefined;
    return error as Record<string, unknown>;
  };

  it("sanitizes unsafe fields for non-500 errors", () => {
    const response = {
      status: 400,
      body: {
        ok: false,
        error: {
          message: ErrorMessage.Bad,
          code: ErrorCode.Bad,
          [ErrorField.Stack]: "trace",
          [ErrorField.Cause]: "cause",
          [ErrorField.Sql]: "select *",
        },
      },
    };
    const sanitized = sanitizeErrorResponse(response);
    const error = getErrorRecord(sanitized.body);
    expect(error?.message).toBe(ErrorMessage.Bad);
    expect(error?.code).toBe(ErrorCode.Bad);
    expect(error?.[ErrorField.Stack]).toBeUndefined();
    expect(error?.[ErrorField.Cause]).toBeUndefined();
    expect(error?.[ErrorField.Sql]).toBeUndefined();
  });

  it("returns ok:false body when error payload is missing", () => {
    const response = {
      status: 400,
      body: { ok: false },
    };
    const sanitized = sanitizeErrorResponse(response);
    expect(sanitized.body.ok).toBe(false);
    expect(getErrorRecord(sanitized.body)).toBeUndefined();
  });

  it("handles non-object errors flagged as typed errors", () => {
    const serializer = getDefaultSerializer();
    const store = {
      errors: new Map([
        [
          "helper",
          {
            is: () => true,
          },
        ],
      ]),
    } as unknown as Store;
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "plain",
      bufferLogs: true,
    });
    const req = {
      headers: {},
      method: "POST",
      url: "/x",
    } as IncomingMessage;
    let statusCode = 0;
    let payload: Buffer | undefined;
    const res = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      end(buf?: unknown) {
        statusCode = this.statusCode;
        if (buf != null) {
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
        }
      },
    } as unknown as ServerResponse;

    handleRequestError({
      error: "boom",
      req,
      res,
      store,
      logger,
      serializer,
      logKey: ExposureErrorLogKey.TaskError,
    });

    expect(statusCode).toBe(500);
    const json = payload
      ? serializer.parse(payload.toString("utf8"))
      : undefined;
    expect(json && typeof json === "object").toBe(true);
    const ok = json ? (json as { ok?: unknown }).ok : undefined;
    expect(ok).toBe(false);
    const error = getErrorRecord(json);
    expect(error?.code).toBe(ErrorCode.Internal);
    expect(error?.message).toBe(ErrorMessage.Internal);
  });
});
