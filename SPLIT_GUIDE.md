# HeySure Multi-Repo Split Guide

This workspace was split from a single monorepo into:

- **HeySure-Web**
- **HeySure-Server**
- **HeySure-Device**

The current repository is the lightweight **workspace** (orchestration) repo.

## 1. Create the three GitHub repositories (do this first)

Go to GitHub and create **three empty repositories** (do **not** add README, .gitignore or license during creation):

- `HeySure-Web`
- `HeySure-Server`
- `HeySure-Device`

Make sure your GitHub username/org is correct (default in scripts is `Blight001`).

## 2. Initialize this workspace (local)

```powershell
# From the root of this checkout
pwsh -File init-env.ps1
```

This will populate `web/`, `server/`, `device/`.

You can also manually `git clone` the three new repos into those directories.

## 3. Recommended: Push current state into the three new repos

Because the repos are empty, the simplest and fastest way is:

### Option A — Using git subtree split (preserves relevant history)

From the workspace root:

```powershell
# Create split branches (one time)
git subtree split --prefix=web   -b split-web
git subtree split --prefix=server -b split-server
git subtree split --prefix=device -b split-device
```

Then push each:

```powershell
git push https://github.com/Blight001/HeySure-Web.git     split-web:main --force
git push https://github.com/Blight001/HeySure-Server.git  split-server:main --force
git push https://github.com/Blight001/HeySure-Device.git  split-device:main --force
```

After pushing, you can delete the split- branches locally if you want:

```powershell
git branch -D split-web split-server split-device
```

### Option B — Fresh start (no history)

If you prefer completely clean history for the new repos:

```powershell
# HeySure-Web
git clone --depth 1 . ../HeySure-Web
cd ../HeySure-Web
git filter-branch --subdirectory-filter web -- --all
git checkout --orphan main
git rm -rf .
git checkout split-web -- .     # or manually copy the web/ content
git add .
git commit -m "Initial import - HeySure-Web"
git remote add origin https://github.com/Blight001/HeySure-Web.git
git push -u origin main --force
```

Repeat for server and device.

## 4. Finalize this workspace repo

After the three repos are pushed:

1. Make sure the current directory only contains the workspace files (no full web/server/device content committed).
2. The `.gitignore` already ignores `/web/`, `/server/`, `/device/`.
3. Commit the new files (`init-env.*`, `.env.example`, clean.*, updated docs, etc.).
4. Push the workspace repo (you can keep the old remote or rename it to `HeySure`).

## 5. After the split — day to day

- Work on individual features in the three separate repos.
- Use the workspace root for:
  - `docker compose`
  - Cross-component testing
  - `init-env.ps1` (to get latest of all three)
  - Root documentation

All paths used by scripts and compose (`./server`, `./web`) remain valid after running `init-env`.

## Notes

- `doc/` stays in the workspace repo.
- Each component repo has its own focused `.gitignore`.
- Update `init-env.ps1` / `init-env.sh` if you change the GitHub org/username.
- If you change the remote URLs later, edit the init scripts.

## Re-cloning everything later

```powershell
git clone https://github.com/Blight001/HeySure.git heysure
cd heysure
pwsh -File init-env.ps1
```

Done.

---

## Finalizing the workspace repo (after pushing the three components)

```powershell
# Stop tracking the three big directories in this workspace repo
git rm -r --cached web server device

git add .
git commit -m "Turn into HeySure workspace. Components live in separate repos now."
git push
```

The physical folders can stay on disk (they will be managed by the init script or you can delete and re-init).
