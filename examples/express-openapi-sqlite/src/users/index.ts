import { usersRepository } from "./resources/users-repository.resource";
import { resource } from "@bluelibs/runner";
import { registerUserTask } from "./tasks/regoster-user.task";
import { loginUserTask } from "./tasks/login-user.task";
import { getUserProfileTask } from "./tasks/get-user-profile.task";
import { getAllUsersTask } from "./tasks/get-all-users.task";
import { authMiddleware } from "./middleware/auth";
import { verifyPasswordTask } from "./tasks/verify-password.task";
import { createUserTask } from "./tasks/create-user.task";

export const users = resource({
  id: "app.modules.users",
  register: [
    usersRepository,
    registerUserTask,
    loginUserTask,
    getUserProfileTask,
    getAllUsersTask,
    verifyPasswordTask,
    createUserTask,
    authMiddleware,
  ],
});
