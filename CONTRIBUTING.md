# Contributing

Thanks for contributing to `ngx-locatorjs`.

## Scope

This repository ships:

1. Browser runtime (`src/browser`) for Alt+Click / hover behavior.
2. Node CLIs (`src/node`) for config setup, component scan, and open-in-editor server.

Please keep changes focused and avoid mixing unrelated refactors in one PR.

## Development Setup

```bash
npm install
```

## Local Checks

Run these before opening a PR:

```bash
npm run build
npm run format:check
```

If formatting fails:

```bash
npm run format
```

## Change Guidelines

1. Keep behavior backward-compatible unless the change explicitly introduces a breaking change.
2. Update README docs when CLI options, config shape, or runtime behavior changes.
3. Keep generated build output in `dist/` out of commits unless release automation explicitly requires it.

## Pull Requests

1. Link the related issue (or explain why no issue exists).
2. Describe what changed and why.
3. List validation steps you ran (`build`, `format:check`, manual test scenario).
4. Keep PRs reviewable in size; split large unrelated edits.

## Questions

Open a GitHub Issue:
https://github.com/Ea-st-ring/ngx-locator/issues
