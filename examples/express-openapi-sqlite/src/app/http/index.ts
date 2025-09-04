import { resource } from "@bluelibs/runner";
import { expressServerResource } from "./resources/express.resource";
import { routeRegistrationHook } from "./hooks/route-registration.hook";

export const http = resource({
  id: "app.modules.http",
  register: [expressServerResource, routeRegistrationHook],
});
