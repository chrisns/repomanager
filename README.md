# GitHub repository manager

![GitHub package.json version](https://img.shields.io/github/package-json/v/chrisns/repomanager)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)
[![MIT Licence](https://badges.frapsoft.com/os/mit/mit.png?v=103)](./LICENSE)
[![ci](https://github.com/chrisns/repomanager/workflows/ci/badge.svg?branch=master)](https://github.com/chrisns/repomanager/actions?query=workflow%3Aci+branch%3Amaster)
[![Coverage Status](https://coveralls.io/repos/github/chrisns/repomanager/badge.svg?branch=master)](https://coveralls.io/github/chrisns/repomanager?branch=master)

GitHub App powered by AWS Lambda to manage your repositories for you — branch
rulesets, security features, repo flags and templated files, defined in YAML
and applied via a reviewable **checkbox consent workflow** on GitHub issues.

## How it works

```text
   .github/repo-config.yml       (per-repo override)
          merged with
   owner/.github/repo-config.yml (org-wide override)
          merged with
   base-repo-config.yml          (this repo's sensible defaults)
                │
                ▼
            planner  ── diff the desired state against the actual state
                │
     ┌──────────┴──────────┐
     ▼                     ▼
 low-risk             high-risk
 (auto-applied)       (consent issue opened
                       with a task list;
                       tick a box to apply)
```

Low-risk toggles (vulnerability alerts, automated security fixes, secret
scanning, push protection, private vulnerability reporting, dependabot security
updates) are applied immediately.

High-risk changes (branch protection, rulesets, repository flags, templated
files) are proposed in a GitHub issue labelled `repomanager:consent` with a
task list. **Tick a checkbox and save, and the webhook applies exactly that
change.** Each item has a stable HTML-comment marker so the tool can tell
which change a box refers to even as you re-order the list.

## Usage

1. Enable [this app](https://github.com/apps/the-repository-manager) for the
   scope you want, per-repository or for your whole account/org.

2. Configure it. Three optional configuration sources are deep-merged (nested
   keys merge, arrays are replaced):

   1. This repository's [`base-repo-config.yml`](base-repo-config.yml)
   2. A repository in your user/org called `.github` with a file named
      `repo-config.yml`. [example](https://github.com/chrisns/.github)
   3. A `.github/repo-config.yml` in the repository being managed.

3. The cron runs every 10 minutes and webhooks fire on pushes to
   `.github/repo-config.yml`, so a config change is usually reflected within
   seconds.

## Configuration example

```yaml
# -- low-risk flags, applied immediately -------------------------------------
vulnerabilityAlerts: true
automatedSecurityFixes: true
secretScanning: true
secretScanningPushProtection: true
privateVulnerabilityReporting: true
dependabotSecurityUpdates: true

# -- repository rulesets (preferred over legacy branchProtection) ------------
rulesets:
  - name: default-branch
    target: branch
    enforcement: active
    conditions:
      ref_name:
        include:
          - '~DEFAULT_BRANCH'
        exclude: []
    rules:
      - type: deletion
      - type: non_fast_forward
      - type: required_linear_history
      - type: pull_request
        parameters:
          required_approving_review_count: 1
          dismiss_stale_reviews_on_push: true
          require_code_owner_review: false
          required_review_thread_resolution: true

# -- legacy branch protection (still works, deprecated) ----------------------
branchProtection:
  - branch: '__DEFAULT_BRANCH__'
    # __DEFAULT_BRANCH__ is dynamically swapped for the repo's default branch
    required_status_checks:
      strict: true
      # contexts: ALL  # special string — picks up every check that ran against the branch
      contexts:
        - build
    required_linear_history: true
    enforce_admins: false
    required_pull_request_reviews: null
    restrictions: null

# -- arbitrary octokit repos.update fields -----------------------------------
repo:
  # https://octokit.github.io/rest.js/#repos-update
  has_issues: true
  has_projects: false
  has_wiki: false
  allow_squash_merge: true
  allow_merge_commit: false
  allow_rebase_merge: true
  delete_branch_on_merge: true

# -- templated files opened as a PR branch (repomanager_files) ---------------
# set `files: false` to skip file templating entirely
files:
  '.github/FUNDING.yml': |
    github: [yourusername]
  'SECURITY.md': |
    # Security Policy
    ## Reporting a Vulnerability
    Please contact you@example.com
```

## The consent issue

When the planner detects drift on a repository it opens (or updates) an issue
titled `repomanager: changes awaiting approval` labelled `repomanager:consent`:

```markdown
## Proposed changes

- [ ] <!-- repomanager:bp:main --> Apply branch protection to `main`
- [ ] <!-- repomanager:ruleset:create:default-branch --> Create ruleset `default-branch`
- [ ] <!-- repomanager:files:pr --> Open PR to update templated files (.github/FUNDING.yml, SECURITY.md)
```

Tick any box and save — the webhook fires `issues.edited`, re-plans the repo,
filters to the ticked IDs and applies only those. Applied items are rewritten
to `[x]` by repomanager itself.

If the plan changes between cron runs (e.g. a desired rule is no longer
needed) the issue body is rewritten with the new list. When there are no
pending changes the issue is closed automatically.

## Invalid configuration

If `repo-config.yml` fails schema validation, repomanager opens an issue
titled `repomanager: invalid repo-config.yml` with a task list of the zod
errors. It is closed automatically on the next run once the config is valid.

## Dry-run

Set `DRY_RUN=true` to log the planned diff without applying anything:

```bash
DRY_RUN=true npm start
```

Use this locally with a sandbox installation, or bake it into a CI smoke job
against a fixture installation to guard against regressions.

## Installation

You only need this if you don't trust the hosted app, want to run on-prem
GitHub Enterprise, or similar.

1. Create a GitHub App: <https://github.com/settings/apps/new>
2. Download the private key (`.pem`) and note the App ID.
3. Deploy with SAM:

    ```bash
    sam build
    sam deploy --guided \
      --parameter-overrides \
        AppId=<app-id> \
        GitHubWebhookSecret=<webhook-secret> \
        Cert="$(cat github-app.pem)"
    ```

4. The stack output `WebhookUrl` is the URL to set in the GitHub App's
   webhook config.

## TODO

- [ ] shard the installations, it won't scale well
- [ ] support permissions on repo
- [ ] manage teams on an org
- [ ] manage webhooks

## CAVEATS

Using this could do all sorts of things — destroy repos, remove access,
basically anything your account can do is granted to this app, its author(s),
and indirectly to everyone in its dependency chain. Do your own due-diligence
before enabling it. The authors/maintainers accept no liability.
