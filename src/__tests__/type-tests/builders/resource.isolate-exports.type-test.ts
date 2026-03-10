import { r } from "../../../";

{
  const publicTask = r
    .task("types-exports-explicit-public")
    .run(async () => "ok")
    .build();

  r.resource("types-exports-explicit-resource")
    .register([publicTask])
    .isolate({ exports: [publicTask] })
    .build();

  r.resource("types-exports-invalid-string").isolate({
    // @ts-expect-error exports must use explicit Runner refs, not strings
    exports: ["types-exports-invalid-string.target"],
  });
}
