# Contributing to BlueLibs Runner

First off — thank you for taking the time to contribute! This guide keeps things simple so you can get help fast and make improvements confidently.

## Filing Issues (the easy way)

Please use the GitHub Issue Forms — they’re short, friendly, and help us help you quickly:

- Bug reports → choose “Bug report”
- Feature ideas → choose “Feature request”
- Docs feedback → choose “Documentation issue”
- Discussions → for general questions or support

Tips for a great issue:

- Provide your Runner version (e.g. from `npm ls @bluelibs/runner`)
- Include your environment (OS, Node version, package manager, relevant frameworks)
- Share a minimal reproduction (repo link or short snippet)
- Paste logs/stack traces inside code fences

## Minimal Reproduction (optional)

A minimal repro makes bugs fixable. Create single file reproduce-ables ([repomix](https://repomix.com/) might help).

If you can’t isolate it, share what you tried — we’ll help.

## Security Issues

Please do NOT open a public issue. Follow the steps in SECURITY.md:

- ./SECURITY.md

## Pull Requests (optional but welcome)

If you’re opening a PR:

- Discuss significant changes first (issue or discussion)
- Keep changes focused and small
- Ensure tests pass locally (`npm test`)
- Add or update tests when changing behavior
- Update docs if the public API changes

## Local Development (quick start)

- Fork and clone the repo
- `npm install`
- Run tests: `npm test`
- Build locally: `npm run build`

## VS Code Copilot Commit Messages (optional)

If you use VS Code + Copilot, you can customize generated commit messages with workspace instructions in `.vscode/settings.json`:

```json
{
  "github.copilot.chat.commitMessageGeneration.instructions": [
    {
      "text": "Use Conventional Commits (feat|fix|refactor|docs|test|chore) with a scope when clear. Keep the subject imperative and <=72 chars, no trailing period. Summarize the real user-facing or architectural change, and mention tests/docs updates when relevant."
    }
  ]
}
```

Note: `.vscode/` is gitignored in this repo, so this stays local to your workspace unless you choose to share it elsewhere.

That’s it — thank you for making Runner better!
