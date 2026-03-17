import { middleware } from "../../../";

{
  middleware.task.identityChecker.with({
    user: true,
    roles: ["ADMIN", "CUSTOMER"],
  });

  middleware.identityChecker.with({
    roles: ["SUPPORT"],
  });

  middleware.task.identityChecker.with({
    // @ts-expect-error tenant can only be omitted or true
    tenant: false,
  });

  middleware.task.identityChecker.with({
    // @ts-expect-error roles must be strings
    roles: [1],
  });
}
