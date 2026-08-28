# Workflow — every new body of work

1. **Git worktree first** — before touching any code, create a git worktree for the change so work stays isolated from `main`:
   ```bash
   git worktree add -b <branch-name> ../nicotine_mobile-<branch-name>
   ```
   Do all work inside that worktree; never edit `main` directly.
2. Run the full testing suite and CI checks from within the worktree:
   ```bash
   bun test && bun run build        # local verify (mirrors CI)
   ```
   Also run any project CI (e.g. GitHub Actions) and ensure it passes.
3. Only once tests and CI are green, open a PR against `main`:
   ```bash
   gh pr create --fill
   ```
   Keep `main` clean — merge via the PR, never commit work straight to `main`.
