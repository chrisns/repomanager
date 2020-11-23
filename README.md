# Github repository manager

GitHub App powered by AWS Lambda to manage your repositories for you.

## Usage

1. Enable [this app](https://github.com/apps/the-repository-manager) for the scope you want it to have, per-repository or for your whole account/org

2. Customize it!

Configuration is formed through merging three potential configuration sources if they exist, `automatedSecurityFixes` and `vulnerabilityAlerts` are always both enabled by default

1. This repository [base-repo-config.yml](base-repo-config.yml)
2. A specifically named repository in the user/org called `repo-config` with a file named `repo-config.yml`. [example](https://github.com/chrisns/repo-config)
3. A `.github/repo-config.yml` in the repository

## Configuration example

```yaml
vulnerabilityAlerts: true
automatedSecurityFixes: true
branchProtection:
  - branch: '__DEFALT_BRANCH__'
    # __DEFALT_BRANCH__ is dynamically swapped out for the repository's default branch
    required_status_checks:
      strict: true
      contexts: []
    required_linear_history: true
    enforce_admins: false
    required_pull_request_reviews: null
    restrictions: null
repo:
  # see octokit docs for all paramshttps://octokit.github.io/rest.js/v18#repos-update
  has_issues: true
  has_projects: false
  has_wiki: false
  is_template: false
  allow_squash_merge: true
  allow_merge_commit: false
  allow_rebase_merge: true
  delete_branch_on_merge: true
license: |
  MIT License
  ..
dependabot: auto # you can either specify the whole dependabot file in here, define it as false and it won't be managed, or auto and it'll try and guess what config you want based on some files in the repo. mileage with auto will vary.
files:
  # You can also specify arbitrary files
  '.github/FUNDING.yml': |
    github: [yourusername]
  'SECURITY.md': |
    # Security Policy
    ## Reporting a Vulnerability
    Please contact you@example.com
```

## Installation

You only really need to do this if you don't trust me, want to run on-prem GitHub Enterprise or similar use case.

1. Create a new GitHub App: https://github.com/settings/apps/new

- Use a temporary Webhook URL

2. Download your GitHub App Private Key (i.e. `.pem` file)
3. Configure this project

- Move `.pem` into this project and change `CERT` variable from `serverless.yml` if required
- Change `APP_ID` to match your new GitHub App

4. Deploy this project. Check out https://serverless.com/framework/docs/getting-started/ for details.
5. Update your GitHub App's Webhook URL

## TODO

- [ ] shard the installations, it won't scale well
- [ ] support permissions on repo
- [ ] manage teams on an org
- [ ] manage webhooks
