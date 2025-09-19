import { EJSON as BaseEJSON } from "@bluelibs/ejson";

// Re-export EJSON as a constant to avoid instrumentation quirks treating re-exports as uncalled functions
export const EJSON = BaseEJSON;
