import { resource } from "@bluelibs/runner";
import { listAllUsers, registerUser, loginUser, currentUser, logoutUser } from "./tasks";
import { auth } from "./resources";

export const users = resource({
  id: "app.users.resources.users",
  meta: {
    title: "Users Module",
    description: "User management module containing authentication and user-related tasks",
  },
  // We register the task here so that it can be used in the Fastify router
  register: [listAllUsers, registerUser, loginUser, currentUser, logoutUser, auth],
});
