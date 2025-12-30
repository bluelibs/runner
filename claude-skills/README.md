# Runner Claude Skills

Claude Skills that ground AI assistants (like Claude Code) in Runner's patterns, best practices, and implementation strategies.

## What are Claude Skills?

[Claude Skills](https://www.anthropic.com/news/skills) are modular knowledge packages that provide context-specific expertise to Claude. When you use Claude Code with Runner, these skills automatically provide:

- **Accurate answers** grounded in Runner's actual patterns
- **Consistent recommendations** based on established best practices
- **Faster onboarding** for new contributors
- **Better code reviews** aligned with Runner's standards

## Available Skills

### 1. runner-expert
**Core Runner knowledge** - Architecture, patterns, and best practices

Use for:
- Understanding Runner concepts (tasks, resources, events, middleware, tags)
- Implementing features using fluent builder API (`r.*`)
- Choosing between implementation approaches
- General Runner development guidance

### 2. runner-tester
**Testing strategies and patterns**

Use for:
- Writing tests for Runner components
- Achieving 100% test coverage
- Debugging test failures
- Test-driven development with Runner
- Mocking dependencies

### 3. runner-feature-builder
**Real-world implementation patterns**

Use for:
- Authentication/authorization
- Building HTTP APIs with Express/Fastify
- Event-driven architectures
- Caching strategies
- Distributed systems with tunnels
- Middleware for cross-cutting concerns
- HTTP route auto-registration

## Installation

### Option 1: Project-Specific (Recommended)

Install skills in your project's `.claude/skills/` directory (shared with team via git):

```bash
# From runner root directory
cp -r claude-skills/runner-* .claude/skills/
```

**Benefits:**
- All team members automatically get the same grounding
- Version controlled with your project
- Consistent across CI/CD and development environments

### Option 2: Global Installation

Install skills globally in `~/.claude/skills/` (personal use):

```bash
# From runner root directory
cp -r claude-skills/runner-* ~/.claude/skills/
```

**Benefits:**
- Available across all your projects
- Personal workflow customization
- Doesn't require team buy-in

## How Claude Uses These Skills

Claude automatically:
1. **Discovers** available skills based on their descriptions
2. **Loads** relevant skills when you ask Runner-related questions
3. **Grounds** responses in Runner's actual patterns and best practices

You don't need to explicitly invoke skills - Claude knows when to use them!

### Example Interactions

```
You: "How do I create a Runner task with middleware?"
Claude: [Automatically loads runner-expert skill]
        [Provides accurate fluent builder pattern with middleware]

You: "Help me write tests for this task"
Claude: [Automatically loads runner-tester skill]
        [Shows proper testing pattern with mocks and coverage]

You: "I need to implement JWT authentication"
Claude: [Automatically loads runner-feature-builder skill]
        [Provides complete auth middleware pattern]
```

## Skill Structure

Each skill is a directory containing `SKILL.md`:

```
claude-skills/
├── runner-expert/
│   └── SKILL.md              # Core patterns and concepts
├── runner-tester/
│   └── SKILL.md              # Testing strategies
└── runner-feature-builder/
    └── SKILL.md              # Implementation patterns
```

The `SKILL.md` file contains:
- YAML frontmatter (name, description, allowed-tools)
- Grounding content (patterns, examples, best practices)
- When to use the skill
- Common mistakes to avoid

## Verifying Installation

To verify skills are installed correctly:

1. Check the directory structure:
```bash
ls -la .claude/skills/
# or
ls -la ~/.claude/skills/
```

2. Ask Claude:
```
You: "What Runner skills are available?"
Claude: [Lists available skills]
```

## For Maintainers

### Updating Skills

When updating Runner patterns or best practices:

1. Edit the relevant `SKILL.md` file
2. Test with Claude Code to verify grounding
3. Commit changes to version control

### Adding New Skills

To create a new skill:

1. Create a directory: `claude-skills/skill-name/`
2. Add `SKILL.md` with YAML frontmatter:
```markdown
---
name: skill-name
description: When and how to use this skill (max 1024 chars)
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write]
---

# Skill Name

[Grounding content here]
```

3. Update this README
4. Update main README.md

## Benefits for Runner

### For Contributors
- Faster onboarding with accurate guidance
- Consistent code patterns across the codebase
- Reduced time asking "how do I..."
- Better code quality from the start

### For Maintainers
- Less time answering repeated questions
- More consistent code reviews
- Institutional knowledge preserved
- Easier to enforce best practices

### For Users
- Accurate examples for common patterns
- Help implementing complex features
- Guidance on testing and coverage
- Production-ready patterns

## Learn More

- [Claude Skills Documentation](https://docs.claude.com/en/docs/claude-code/skills)
- [Claude Skills Announcement](https://www.anthropic.com/news/skills)
- [Runner Documentation](../README.md)
- [Runner AI Guide](../AI.md)

## Contributing

Found a pattern that should be in a skill? Have improvements?

1. Edit the relevant `SKILL.md` file
2. Test the changes with Claude Code
3. Submit a PR with your improvements

Skills should be:
- **Accurate** - Reflect actual Runner patterns
- **Concise** - Focus on key patterns, not exhaustive docs
- **Practical** - Include real-world examples
- **Up-to-date** - Keep in sync with Runner changes

---

**Questions?** Open an issue or discussion on the [Runner repository](https://github.com/bluelibs/runner).
