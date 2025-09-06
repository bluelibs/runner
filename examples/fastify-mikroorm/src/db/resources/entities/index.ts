import { resource } from "@bluelibs/runner";
import { postEntity } from "./post.entity";
import { userEntity } from "./user.entity";

// Modify this and the rest will adapt automatically
export const entitiesResourceMap = {
  Post: postEntity,
  User: userEntity,
};

export const entities = resource({
  id: "app.db.resources.entities",
  meta: {
    title: "Database Entities Collection",
    description: "Aggregated collection of all MikroORM entity schemas for the application",
  },
  register: [...Object.values(entitiesResourceMap)],
  dependencies: entitiesResourceMap,
  init: async (_, deps) => deps,
});
