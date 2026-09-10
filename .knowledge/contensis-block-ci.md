---
applies_to: any repo pushing a Contensis block from CI with contensis/block-push or contensis/cli-action
keywords:
  [
    block-push,
    cli-action,
    github actions,
    commit message,
    eval,
    shell injection,
    ghcr,
    push block,
    manifest.json,
    release,
    make-live,
  ]
type: standard
description: How a block reaches Contensis from CI, and the commit-message shell injection in the official actions that will break the push
---

# Pushing a block from CI

Contensis never builds from source. CI builds the image, pushes it to a registry
Contensis can pull, and hands over the image URI. `contensis push block` registers it.

The proven shape for this repo, and for `zengenti/ui` before it: build with
`docker/build-push-action@v6`, publish to ghcr, then call the Contensis CLI. `prs` pulls
`ui-storybook` from `ghcr.io/zengenti/ui/ui-storybook` with `image.status: "external"`,
so **ghcr is a proven registry for `prs`**, and a public package needs no pull credentials.

## The commit message is executed by a shell

**Confirmed 2026-09-10**, run `34456294182`, which died on:

```
sh: eval: line 6: syntax error: unterminated quoted string
```

`contensis/block-push@v1` interpolates the raw commit message into the command string it
hands to `contensis/cli-action@v1`:

```yaml
command: push block ... --commit-message "${{ github.event.head_commit.message }}" ...
```

and `contensis/cli-action@v1` ends its container script with:

```sh
eval contensis $CONTENSIS_COMMAND --output output.json
```

An **unquoted variable passed to `eval`**. So every backtick, quote and newline in a
commit message is interpreted by the shell. A conventional multi-line message with
backticked identifiers, which is to say a normal message in this repo, is enough to break
the push.

(The bare `17.2.1.53` in that run's log is **not** injection output, though it reads like
it. `cli-action` runs `contensis get version` before the eval, and that is the CMS version,
the same value the `contensis-classic-version` response header carries. The evidence for
execution is the local reproduction below, not that line.)

Reproduce it without CI:

```bash
contensis() { printf 'ARG: %s\n' "$@"; }
CONTENSIS_COMMAND='push block x img main --commit-message "subject

body with `dist` and an apostrophe'"'"'s quote"'
eval contensis $CONTENSIS_COMMAND      # dist: command not found, then a parse error
```

**This is a command injection, not just a quoting bug.** A commit message is
attacker-controlled input, and `CONTENSIS_SHARED_SECRET` is in that container's
environment. Anyone who can land a commit on a branch that deploys can run commands
next to the credential. Worth raising with Contensis.

### Working around it

Two options, in order of preference:

1. **Skip `block-push` and call `cli-action` directly**, passing metadata through a
   sanitiser. `.github/workflows/website-block.yml` is the worked example: take the
   commit **subject only** and strip the characters a shell would interpret.

   ```bash
   FIRST=${SUBJECT%%$'\n'*}
   echo "message=${FIRST//[\`\"\'$\\]/}" >> "$GITHUB_OUTPUT"
   ```

   Read `SUBJECT` from the step's `env:`, never interpolate `${{ }}` into a script body,
   which is the same injection one layer up. Keep the surrounding double quotes on
   `--commit-message` so spaces and parentheses survive; stripping the inner quotes is
   what stops the outer pair being closed early.

   `block-push` also does a `jq` parse for its `block-version` output and an optional
   repo tag. Dropping it loses both; neither is needed to deploy.

2. **Keep `block-push` and write shell-safe commit messages.** No workflow complexity,
   but it is a trap for every future commit and leaves the injection path open.

## Other things that will bite

- **`release` does not mean live.** It registers and releases the version. Making it
  live is a separate manual CMS action, or `--make-live`.
- **A ghcr package is private by default**, so Contensis cannot pull it. A block push
  that succeeds but never runs is usually this.
- **A first push appears to create its own renderer.** `tim` had zero renderers before
  the first `push block` and a `website` renderer with an `assignedContentTypes: *`
  catch-all immediately after, so the block served the site view with no manual step.
  Observed once, on a project with no renderers at all; do not assume it holds where a
  renderer already claims the catch-all. Verify with `contensis list renderers`.
- **`github.repository` is unsafe in a ghcr image name** unless the org is lowercase.
  ghcr rejects uppercase in a repository path, so `ZenSamClifford/...` fails where
  `zengenti/...` works. Hardcode the lowercase path.
- **`--repository-url` takes `owner/repo`, not a URL.** From the CLI image,
  `dist/commands/push.js`:

  ```js
  repositoryUrl: {
    $path: ["repositoryUrl", "CI_PROJECT_URL", "GITHUB_REPOSITORY"],
    $formatting: (url, { GITHUB_ACTIONS }) => {
      if (GITHUB_ACTIONS) url = `https://github.com/${url}`;
      if (url && !url.endsWith(".git")) return `${url}.git`;
      return url;
    }
  }
  ```

  So the CLI adds both the scheme and the `.git`. Passing a full URL, as `block-push`
  does, yields `https://github.com/https://github.com/Owner/repo.git` and dead commit
  links in the CMS. Cosmetic, but it is wrong in the official action too.

  The same block shows `provider`, `branch` and `commit.id` all resolving from
  `GITHUB_*` env vars unaided, so only the commit **message** genuinely has to be
  passed: its fallback is `CI_COMMIT_MESSAGE`, which is GitLab-only.

- **Zengenti self-hosted runners** (`runs-on: [self-hosted, linux]`) are the org rule,
  but a personal repo has no access to that pool and must use `ubuntu-latest`.

See `contensis-request-handler-contract.md` for `manifest.json`, which is how the block
declares `enableFullUriRouting`, and `contensis-test-environments.md` for which alias and
project are safe to push to.
