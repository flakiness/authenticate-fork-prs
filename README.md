# flakiness/authenticate-fork-prs

Lets test reporters upload to [flakiness.io](https://flakiness.io) from pull requests from
forks. GitHub gives those jobs neither secrets nor OIDC tokens, so this action gets an
access token another way and sets `FLAKINESS_ACCESS_TOKEN` for the subsequent steps.

In every other run (pushes, pull requests from the same repository) it does nothing, so
those keep authenticating with OIDC.

## Usage

Enable **Accept uploads from pull requests from forks** in the project's Access settings,
then:

```diff
 on:
   push:
   pull_request:

 permissions:
   contents: read
   id-token: write   # OIDC for runs that aren't from forks

 jobs:
   test:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v5
+      - uses: flakiness/authenticate-fork-prs@v1
+        with:
+          flakiness-project: my-org/my-project
       - run: npx playwright test
```

> [!IMPORTANT]
> In a private repository, flakiness.io needs the job's token to be able to see this
> run's artifacts:
>
> ```yaml
> permissions:
>   actions: read
> ```

If flakiness.io can't issue a token, the step fails. Add `continue-on-error: true` to the
step to run the tests anyway.

## How it works

1. The action picks a random secret and uploads an artifact named
   `flakiness-auth-<sha256 of the secret>` into the current run. Only a job of the run
   can do that.
2. It sends the secret, the run id and the job's `GITHUB_TOKEN` to flakiness.io. With one
   GitHub API request, made with that token, flakiness.io looks for the artifact in that
   run of the project's linked repository. If it's there and the run is for a pull request
   from a fork, it returns an access token for the project, valid for 6 hours.
3. The action deletes the artifact.

The artifact's name is visible to anyone, but it gives away only the hash of the secret.

The token can only upload reports to the project. Anyone who can open a pull request can
get one, so treat those uploads as untrusted.

## Inputs

| Input | Default | |
| --- | --- | --- |
| `flakiness-project` | `$FLAKINESS_PROJECT` | `org/project`. Required if `FLAKINESS_PROJECT` isn't set. |
| `github-token` | `${{ github.token }}` | Used to look up this run's artifacts. Never stored. |
| `endpoint` | `https://flakiness.io` | |

## Development

```sh
pnpm install
pnpm build   # writes dist/index.js, which must be committed
```
