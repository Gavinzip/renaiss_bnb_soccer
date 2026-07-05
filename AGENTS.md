# Agent Instructions

- Do not push or upload Git changes unless the user explicitly approves it.
- Keep code maintainable and separated by responsibility. Do not pack unrelated behavior into one file.
- Do not use fallback behavior as the fix. Find the root cause. If a fallback exists or is added, tell the user where it is and why.
- Keep production, local, mock, and test data clearly separated when debugging or reporting results.
- Treat Zeabur deployment as a runtime verification task, not just a Git push.
- For any Zeabur deploy, verify the service is using the intended repo, branch, root directory, and Dockerfile.
- Pin the Dockerfile when ambiguity is possible. Prefer `zbpack.json` / `zbpack.<service>.json` or `ZBPACK_DOCKERFILE_PATH`.
- Check that `ZBPACK_IGNORE_DOCKERFILE` is not accidentally enabled and that the service is not using a prebuilt image or Node builder when Git plus Dockerfile is intended.
- Do not assume Dockerfile edits are active just because a commit was pushed. Check Zeabur deploy logs for Dockerfile usage and then probe the live runtime behavior that depends on the Dockerfile.
- Runtime-generated requirements must be built, copied, and asserted inside the Docker image. Do not rely on local ignored artifacts being present in Zeabur.
