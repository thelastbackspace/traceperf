# Releasing

Releases are published by CI when a version tag is pushed. Nothing is published from a laptop.

1. Make sure `main` is green in CI.
2. Update `CHANGELOG.md`: rename `[x.y.z] - Unreleased` to today's date.
3. Bump the version without creating a tag: `npm version x.y.z --no-git-tag-version`.
4. Commit: `git commit -am "release: vx.y.z"`.
5. Tag and push:

   ```bash
   git tag vx.y.z
   git push origin main vx.y.z
   ```

6. CI runs every job (unit tests on Node 18–24, the packed-tarball checks on Node 14–24, Bun, Deno, real browsers, docs, budgets). Then the `publish-npm` job:
   - checks that the tag matches `package.json`;
   - builds;
   - runs `npm publish --provenance`, so the npm page shows where and how the package was built.
7. Create the GitHub release from the CHANGELOG section.

Requirements: an `NPM_TOKEN` repository secret (an npm automation token with publish rights).

Suggested order for the pending branches:

| Version | Branch | Notes |
|---|---|---|
| 0.2.2 | `fix/reliability-audit` | bug fixes only |
| 0.3.0 | `feat/0.3.0` | additive. Options are strictly typed, so misspelled options fail to compile. |
| 1.0.0 | `feat/v1` | removes the legacy logging API (see MIGRATION.md) |
| 1.1.0 | `feat/1.1` | OpenTelemetry live mode, auto-instrumentation, CLI, Bun/Deno |
