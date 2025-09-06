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
</rules>
