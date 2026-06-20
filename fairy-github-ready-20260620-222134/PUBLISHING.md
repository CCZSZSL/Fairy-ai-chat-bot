# Publishing to GitHub

Publish this clean source folder, not your personal working folder.

Use:

```text
fairy-github-ready-*
```

Do not upload:

```text
your personal working folder
privacy-clean transfer packages
fairy-memory/
node_modules/
dist/
runtime/
```

## Option A: GitHub Desktop

1. Install GitHub Desktop.
2. Choose `File -> Add local repository`.
3. Select this folder.
4. If prompted, create a repository.
5. Commit all files.
6. Publish repository.

## Option B: Command Line

Create an empty repository on GitHub first, then run:

```powershell
git init
git add .
git commit -m "Initial open source release"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/fairy.git
git push -u origin main
```

## Before Publishing

Run a final check:

```powershell
git status --ignored
```

Make sure private data remains ignored:

- `fairy-memory/`
- `node_modules/`
- `dist/`
- `.tmp/`
- `.electron-cache/`
- screenshots
- voice samples
- API keys
