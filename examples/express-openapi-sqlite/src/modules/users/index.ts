import { usersRepository } from "./repository/users.repository";
import { resource } from "@bluelibs/runner";
import { registerUserTask } from "./tasks/registerUser.task";
import { loginUserTask } from "./tasks/loginUser.task";
import { getUserProfileTask } from "./tasks/getUserProfile.task";
import { getAllUsersTask } from "./tasks/getAllUsers.task";
import { authMiddleware } from "./middleware/auth";
import { verifyPasswordTask } from "./tasks/verifyPassword.task";
import { createUserTask } from "./tasks/createUser.task";

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
