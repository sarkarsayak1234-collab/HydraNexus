# CI benchmark workflow — activation required

`benchmark.workflow.yml` is the GitHub Actions workflow that runs the real
BattLeDIM 2018 ground-truth benchmark on every push/PR (install backend deps →
`python backend/test_benchmark_local.py`).

**It is parked here (not in `.github/workflows/`) only because the current
GitHub Personal Access Token lacks the `workflow` scope — GitHub rejects any
push that creates or updates workflow files without it.**

To activate:

1. Update the token: GitHub → Settings → Developer settings → Personal access
   tokens → edit the token → tick the **`workflow`** scope.
2. Move this file into place and push:

   ```powershell
   Move-Item docs\ci\benchmark.workflow.yml .github\workflows\benchmark.yml
   git add -A
   git commit -m "ci: activate ground-truth benchmark workflow"
   git push origin main; git push rito main
   ```

The README's benchmark badge will start reporting once the workflow runs.
