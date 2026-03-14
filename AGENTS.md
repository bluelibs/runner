<general>
- Be passionate about what you do, be precise, thoughtful and clear.
- As you are working do not modify, revert other changes without user confirmation.
- The code should be designed awithout being over-engineered.
- The code should be human-friendly (descriptive variables, function names, comments that describe the 'why'), code readability are a big plus.
- Keep functions small, decouple early on. Make code be read like a story.
- Keep non-documentation files small (under 300 lines) (including tests). Decouple/destructure early on.
- When doing a tasks, first think about the contracts and interfaces, then think about the acceptance criteria, and only then think about implementation.
- Type-strictness is a must, avoid type casting unless forced to
- Use `npm run qa` to test the full suite and see coverage in a token-friendly way, run lint and typecheck. 
- You can speed up process by running individual/focused tests instead of the full suite. For those (`npm run test -- searchKey`) is fine
- If there's global under 100% coverage on files/concerns you didn't work on, ignore those files.
- Always run the tests, don't assume that you're fix worked.
- When running commands, don't run them with bash -lc, or zsh -lc, run the commands directly.
- Use only relative imports
- Be truthful and avoid ignoring files in test configs as a way to achieve 100%.
- Work with agent-enabled TODO lists! TODO lists help you remain on-track.
- All imports should be put on top, unless an optimization or something specific, default to top imports as preference instead of inline.
- Do not ask the user if you should do something that is likely the user would want to do
- Make use of enums when dealing with a set of values for things like statuses, types, etc.
- The tests are in mirror-like structure under ./src/__tests__/ folder.
- Always think isolation. Each container (r.run()) should be completely isolated from any other parallel r.run(), meaning we have to design for things within the container.
</general>

<specifics>
- This library has 100% code coverage.
- Node specific code (Async Context, Durable Workflows, Remote Lanes, etc) goes under ./src/node/ folder. It is exported only for node.
- This package is multi-platform (readmes/MULTIPLATFORM.md) be sure to take this into account when implementing changes
- AI.md (readmes/AI.md) contains AI-token-friendly documentation about Runner. Read it if the task implies that you know Runner.
- Always run `npm run qa` to ensure type safety and linting. (Expected to take around 30 seconds, if working only on docs, don't run it)
- Never revert changes from other files that you did not modify.
- Apply fail-fast principles. If something is not as expected, throw an error immediately.
- This is a framework, it's documentation is composed dynamically into FULL_GUIDE.md (which should not be read/manipulated by AI), read guide-units/DOCS_STYLE_GUIDE.md for more info, useful when we make changes or new features.
- Attention when coding defensively (especially when using 'unknown' and lots of typeof), we use typescript and we want to offer public and inner surface absolute type-safety. This means once the trust-boundary has passed (user-input ended), we can be sure of the types.
- Use check/Match when you have to validate values at runtime, much cleaner.
- Be careful when polluting your context with FULL_GUIDE.md, it's generated so don't worry about it.
- All public surfaces direct or indirect through types must have propper JSDoc comments.
</specifics>

<new_feature>

- Prefer to use type strings instead of enums
- When building new features/enhancements/changes, must be implemented with care without affecting the system and not over-polute files.
- Code retain 100% test coverage.
- Use check() as much as you can for runtime constraints, it's very useful (and powerful) and avoids typeof hell. (hint: Custom WithMessage error h)
- Ensure readmes/AI.md (minimal version of README) and that the guide-units with the full guide are updated accordingly.
- Document 'why' in comments, not 'what' or 'how', as the code should be self-descriptive enough to explain those.
- Use runner errors instead of 'throw new Error()' for better error handling and consistency.
- Read guide-units/DOCS_STYLE_GUIDE.md to understand how we compose the main documentation.
- Do not include deprecated values/information in AI.md.
  </new_feature>

  <work_style>
  Re-read this document after every todo.

  You will work in LOG.md in which everyone will have a

====dramatic task title===
{what am I currently doing, updated regularly and safe}
==========================

It's good to know when other agents are working, after you finish, clean it up.
</wo
