import { resources } from "../../../";
import { Match } from "../../../decorators/legacy";

// Type-only tests for resources.serializer.with(...)
{
  class UserDto {
    public id!: string;
  }

  Match.Schema()(UserDto);
  Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

  resources.serializer.with({
    schemas: [UserDto],
  });

  resources.serializer.with({
    types: [
      {
        id: "TypeTestDate",
        is: (value): value is Date => value instanceof Date,
        serialize: (value) => value.toISOString(),
        deserialize: (value) => new Date(value),
      },
    ],
  });

  resources.serializer.with({
    // @ts-expect-error schema entries must be Match.Schema() classes
    schemas: [123],
  });

  resources.serializer.with({
    types: [
      {
        // @ts-expect-error serializer type ids must be strings
        id: 123,
        is: (value): value is Date => value instanceof Date,
        serialize: (value) => value.toISOString(),
        deserialize: (value) => new Date(value),
      },
    ],
  });
}
