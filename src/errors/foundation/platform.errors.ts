import { error } from "../../definers/builders/error";
import { detectEnvironment } from "../../platform";
import type { DefaultErrorType } from "../../types/error";

// Context error
export const contextError = error<{ details?: string } & DefaultErrorType>(
  "runner.errors.context",
)
  .format(({ details }) => details ?? "Context error")
  .remediation(
    "Verify the async context is registered in a parent resource and that .provide() was called before .use(). If the context is optional, use .optional() when declaring the dependency.",
  )
  .build();

// Platform unsupported function
export const platformUnsupportedFunctionError = error<
  { functionName: string } & DefaultErrorType
>("runner.errors.platformUnsupportedFunction")
  .format(
    ({ functionName }) =>
      `Platform function not supported in this environment: ${functionName}. Detected platform: ${detectEnvironment()}.`,
  )
  .remediation(
    ({ functionName }) =>
      `The function "${functionName}" requires a Node.js environment. If running in a browser or edge runtime, use a platform-compatible alternative or guard the call with a platform check.`,
  )
  .build();
