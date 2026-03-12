# Contributing to Vainplex OpenClaw Plugin Suite

## Development Workflow

All changes go through Pull Requests. No direct pushes to `main`.

### For features and fixes

```bash
# 1. Create a feature branch
git checkout -b feat/my-feature  # or fix/my-bug

# 2. Make changes, commit
git add -A
git commit -m "feat: add cool thing"

# 3. Push and create PR
git push -u origin feat/my-feature
gh pr create --title "feat: add cool thing" --body "Description..."
```

### Review pipeline

Every PR is reviewed by:

1. **CodeRabbit** (automatic) — AI code review, security checks, best practices
2. **Cerberus** (internal) — our dedicated code review agent
3. **Human approval** — required for merge

### Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — maintenance, deps, CI
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests

### Before submitting

- [ ] Tests pass (`npm test`)
- [ ] TypeScript compiles (`npm run build`)
- [ ] No lint errors
- [ ] Changelog updated (for releases)

### npm publishing

Publishing to npm happens **only after merge to main** and requires:

1. Version bump (`npm version patch|minor|major`)
2. Cerberus review approval
3. All CI checks green

## Plugin structure (monorepo)

```
packages/
  openclaw-governance/    — Policy engine, approval manager
  openclaw-cortex/        — Thread tracking, decisions, commitments
  openclaw-membrane/      — Episodic memory (Membrane bridge)
  openclaw-leuko/         — Cognitive immune system
  openclaw-knowledge-engine/ — Knowledge graph
  nats-eventstore/        — NATS JetStream event store
```

## Questions?

Open an issue or reach out on [Discord](https://discord.com/invite/clawd).
