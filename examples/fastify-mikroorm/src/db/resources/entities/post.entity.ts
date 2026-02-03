import { r } from "@bluelibs/runner";
import { BaseEntity, EntitySchema } from "@mikro-orm/core";
import { User } from "./user.entity"; // Import User class for relation

export class Post extends BaseEntity {
  id!: string;
  title!: string;
  content!: string;
  author!: User; // Relation to User
}

export const postEntity = r
  .resource("app.db.entities.resources.post")
  .meta({
    title: "Post Entity Schema",
    description:
      "MikroORM entity schema for Post with user relationship and content fields",
  })
  .init(
    async () =>
      new EntitySchema<Post>({
        name: "Post",
        class: Post,
        tableName: "posts",
        properties: {
          id: { type: "uuid", primary: true },
          title: { type: "string" },
          content: { type: "string" },
          author: {
            kind: "m:1",
            entity: () => "User",
            nullable: false,
            inversedBy: (user) => user.posts,
          },
        },
      }),
  )
  .build();
