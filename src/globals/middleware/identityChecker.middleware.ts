import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import {
  identityAuthorizationError,
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";
import type { IdentityRequirementConfig } from "../../public-types";
import { identityContextResource } from "../resources/identityContext.resource";
import {
  assertIdentityRequirement,
  identityRequirementPattern,
} from "./identityRequirement.shared";

/**
 * Task middleware that blocks execution unless the active identity satisfies
 * the configured tenant/user/role gate.
 */
export const identityCheckerTaskMiddleware =
  defineTaskMiddleware<IdentityRequirementConfig>({
    id: "identityChecker",
    meta: {
      title: "Identity Checker",
      description:
        "Blocks task execution unless the active runtime identity satisfies the configured tenant, user, and role requirements.",
    },
    throws: [
      identityContextRequiredError,
      identityInvalidContextError,
      identityAuthorizationError,
    ],
    configSchema: identityRequirementPattern,
    dependencies: {
      identityContext: identityContextResource,
    },
    async run({ task, next }, { identityContext }, config) {
      assertIdentityRequirement(config, identityContext.tryUse);
      return next(task.input);
    },
  });
