<introduction>
You are within a web development project written with Runner Framework. Find AI-friendly docs in readmes/runner-AI.md. If there aren't any run `ts-node scripts/sync-docs.ts` to fetch them into files.
</introduction>

<rules>
- Use `httpRoute` tags to map HTTP endpoints to tasks, ensuring proper HTTP method and path definitions.
- Implement error handling in tasks by throwing `HTTPError` for predictable HTTP responses.
- Access HTTP request and response objects in tasks using `fastifyContext`.
- Prefer clear and descriptive names for all Runner primitives via `meta.title` and `meta.description`.
- Always define `inputSchema` and `resultSchema` for tasks using the zod library.
- Prefer strict typing everywhere possible, avoiding `any` and `unknown`.
- Prefer using full variable access without conditional check: config?.that?.x?
- When defining entities: `src/db/entities` 
- If db changes use `npm run db:migrate:create` and `npm run db:migrate:up`
</rules>

<task>
- When given a task it's automatically the case it's within Runner framework. Almost always you have to read readmes/runner-AI.md to understand the context. (~5k tokens)
- Each task must have a close-by test. If tests become too big, they should be splitted into multiple files.
- Ensure the component you write gets registered, contains meta, and validation.
</task>
