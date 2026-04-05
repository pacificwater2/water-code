# Water Code GitHub Publish Guide

This guide prepares `Water Code` for a source release on GitHub plus an attached packaged tarball.

## 1. Final local checks

From the repo root:

```bash
npm run ship-check
```

This validates:

- automated tests
- package install behavior
- a temporary real Git/worktree workflow
- release docs and tarball contents

## 2. Create or confirm the Git repository

If the folder is not already a Git repo:

```bash
cd /path/to/water-code
git init
git add .
git commit -m "Release Water Code v0.1.0"
git branch -M main
```

## 3. Create the GitHub repository

### Option A: GitHub web UI

Create a new repository manually, then connect it locally:

```bash
git remote add origin git@github.com:<YOUR_GITHUB_USERNAME>/water-code.git
git push -u origin main
```

### Option B: GitHub CLI

```bash
gh repo create water-code --public --source=. --remote=origin --push
```

Use `--private` instead of `--public` if you want a private source release.

## 4. Tag the release

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 5. Attach the packaged tarball to a GitHub Release

The packaged build lives at:

`dist/water-code-0.1.0.tgz`

You can create the GitHub Release with:

```bash
gh release create v0.1.0 \
  dist/water-code-0.1.0.tgz \
  --title "Water Code v0.1.0" \
  --notes-file docs/github-release-v0.1.0.md
```

## 6. Recommended files to keep visible in the repo root

- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `docs/user-manual-zh.md`
- `docs/release-playbook.md`
- `docs/github-release-v0.1.0.md`

## 7. Publishing notes

- The repo now uses the MIT License.
- `package.json` is still marked `private: true`, which prevents accidental npm publish.
- GitHub publishing and GitHub Releases are unaffected by `private: true`.
- If you later want npm publishing, you should deliberately revisit:
  - `private`
  - `repository`
  - `homepage`
  - `bugs`
  - npm ownership and package name availability
