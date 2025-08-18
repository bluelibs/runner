import { resource } from "@bluelibs/runner";
import { expressServerResource } from "./expressServer";
import { routeRegistrationHook } from "./routeRegistration.hook";

export const http = resource({
  id: "app.modules.http",
  register: [expressServerResource, routeRegistrationHook],
});
