import { Migration } from "@mikro-orm/migrations";

export class Migration20250906000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "users" add column if not exists "password_hash" varchar(255) null, add column if not exists "password_salt" varchar(255) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "users" drop column if exists "password_hash", drop column if exists "password_salt";`,
    );
  }
}
