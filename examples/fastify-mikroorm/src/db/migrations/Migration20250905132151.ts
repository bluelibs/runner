import { Migration } from '@mikro-orm/migrations';

export class Migration20250905132151 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "users" ("id" uuid not null, "name" varchar(255) not null, "email" varchar(255) not null, constraint "users_pkey" primary key ("id"));`);

    this.addSql(`create table "posts" ("id" uuid not null, "title" varchar(255) not null, "content" varchar(255) not null, "author_id" uuid not null, constraint "posts_pkey" primary key ("id"));`);

    this.addSql(`alter table "posts" add constraint "posts_author_id_foreign" foreign key ("author_id") references "users" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "posts" drop constraint "posts_author_id_foreign";`);

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop table if exists "posts" cascade;`);
  }

}
