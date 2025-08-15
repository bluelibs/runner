import { resource } from "@bluelibs/runner";
import { expressServerResource } from "./expressServer";
import { routeRegistrationListener } from "./routeRegistration.listener";

export const http = resource({
  id: "app.modules.http",
  register: [expressServerResource, routeRegistrationListener],
});
