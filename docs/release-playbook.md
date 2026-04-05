# Water Code Release Playbook

This playbook is the final gate before tagging or sharing a Water Code build.

## Release goals

- the CLI installs cleanly from a packaged tarball
- the runtime still works in a real Git-backed project
- bridge, adapter, and editor-side surfaces remain aligned
- release notes and operator docs stay in sync with shipped behavior

## Required checks

Run these from the repo root:

```bash
npm run verify
npm run package-smoke
npm run real-world-smoke
npm run release-check
```

For a fuller bridge validation on a machine that allows localhost binding:

```bash
npm run bridge-smoke
```

## Recommended ship gate

For a single release-readiness pass:

```bash
npm run ship-check
```

This covers:

- automated tests
- local smoke checks
- package install smoke
- real Git/project workflow smoke
- release metadata and tarball inspection

## Release checklist

1. Confirm the version in `package.json` matches the intended release.
2. Update `CHANGELOG.md` with user-visible changes.
3. Run `npm run ship-check`.
4. Inspect the generated tarball in `dist/`.
5. Run `npm link` or install the tarball manually for one final local sanity check.
6. Keep `private: true` until registry metadata and ownership are intentionally configured.

## Current publishing stance

`Water Code` is packaging-ready but still intentionally marked `private` in `package.json`.

That means:

- tarball-based installs are supported
- local/global npm installs from the tarball are supported
- accidental registry publish is blocked until ownership and package metadata are deliberately opened up
