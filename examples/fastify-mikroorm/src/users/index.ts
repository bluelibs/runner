import { resource } from "@bluelibs/runner";
import {
  listAllUsers,
  registerUser,
  loginUser,
  currentUser,
  logoutUser,
} from "./tasks";
import { auth } from "./resources";
import { authorize } from "../http/middleware/authorize.middleware";

export const users = resource({
  id: "app.users.resources.users",
  meta: {
    title: "Users Module",
    description:
      "User management module containing authentication and user-related tasks",
  },
  // We register the task here so that it can be used in the Fastify router
  register: [
    // tasks
    listAllUsers,
    registerUser,
    loginUser,
    currentUser,
    logoutUser,
    // resources and middlewares
    auth,
    authorize,
  ],
});
