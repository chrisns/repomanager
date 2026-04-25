const applyVulnerabilityAlerts = async (octokit, repo, value) => {
  const args = { owner: repo.owner.login, repo: repo.name }
  if (value) return octokit.rest.repos.enableVulnerabilityAlerts(args)
  return octokit.rest.repos.disableVulnerabilityAlerts(args)
}

const applyAutomatedSecurityFixes = async (octokit, repo, value) => {
  const args = { owner: repo.owner.login, repo: repo.name }
  if (value) return octokit.rest.repos.enableAutomatedSecurityFixes(args)
  return octokit.rest.repos.disableAutomatedSecurityFixes(args)
}

const applyRepoSecurityFeature = async (octokit, repo, key, value) => {
  const security_and_analysis = {}
  const mapping = {
    secretScanning: 'secret_scanning',
    secretScanningPushProtection: 'secret_scanning_push_protection',
    privateVulnerabilityReporting: 'private_vulnerability_reporting',
    dependabotSecurityUpdates: 'dependabot_security_updates',
  }
  security_and_analysis[mapping[key]] = { status: value ? 'enabled' : 'disabled' }
  return octokit.rest.repos.update({
    owner: repo.owner.login,
    repo: repo.name,
    security_and_analysis,
  })
}

const applyBranchProtection = async (octokit, repo, config) => {
  return octokit.rest.repos.updateBranchProtection({
    owner: repo.owner.login,
    repo: repo.name,
    ...config,
  })
}

const applyRuleset = async (octokit, repo, change) => {
  const body = {
    owner: repo.owner.login,
    repo: repo.name,
    ...change.ruleset,
  }
  if (change.action === 'create') {
    return octokit.rest.repos.createRepoRuleset(body)
  }
  return octokit.rest.repos.updateRepoRuleset({ ...body, ruleset_id: change.rulesetId })
}

const applyRepoUpdate = async (octokit, repo, config) => {
  return octokit.rest.repos.update({
    owner: repo.owner.login,
    repo: repo.name,
    ...config,
  })
}

const hasClosedUnmergedPullRequest = async (octokit, repo, headBranch) => {
  try {
    const pulls = await octokit.rest.pulls.list({
      owner: repo.owner.login,
      repo: repo.name,
      head: `${repo.owner.login}:${headBranch}`,
      state: 'closed',
      per_page: 100,
    })
    return pulls.data.some((pr) => pr.state === 'closed' && !pr.merged_at)
  } catch {
    return false
  }
}

const applyFiles = async (octokit, repo, files) => {
  const headBranch = 'repomanager_files'
  if (await hasClosedUnmergedPullRequest(octokit, repo, headBranch)) {
    console.info(
      `${repo.owner.login}/${repo.name}: skipping templated files PR (a previous PR was closed unmerged)`,
    )
    return { skipped: true }
  }
  // update: true makes the call idempotent — if a PR with this head branch
  // already exists (open from a previous apply) the plugin updates it in
  // place rather than throwing "Pull request already exists".
  return octokit.createPullRequest({
    owner: repo.owner.login,
    repo: repo.name,
    title: 'Update templated files',
    body: '',
    createWhenEmpty: false,
    update: true,
    head: headBranch,
    changes: [
      {
        files,
        emptyCommit: false,
        commit: 'Update templated files',
      },
    ],
  })
}

const applyChange = async (octokit, repo, change) => {
  switch (change.kind) {
    case 'vulnerabilityAlerts':
      return applyVulnerabilityAlerts(octokit, repo, change.value)
    case 'automatedSecurityFixes':
      return applyAutomatedSecurityFixes(octokit, repo, change.value)
    case 'secretScanning':
    case 'secretScanningPushProtection':
    case 'privateVulnerabilityReporting':
    case 'dependabotSecurityUpdates':
      return applyRepoSecurityFeature(octokit, repo, change.kind, change.value)
    case 'branchProtection':
      return applyBranchProtection(octokit, repo, change.config)
    case 'ruleset':
      return applyRuleset(octokit, repo, change)
    case 'repo':
      return applyRepoUpdate(octokit, repo, change.config)
    case 'files':
      return applyFiles(octokit, repo, change.files)
    default:
      throw new Error(`Unknown change kind: ${change.kind}`)
  }
}

const applyChanges = async (octokit, repo, changes, { dryRun = false } = {}) => {
  const results = []
  for (const change of changes) {
    if (dryRun) {
      console.info(`[dry-run] ${repo.owner.login}/${repo.name}: ${change.summary}`)
      results.push({ change, status: 'dry-run' })
      continue
    }
    try {
      const result = await applyChange(octokit, repo, change)
      results.push({ change, status: 'applied', result })
    } catch (error) {
      console.error(`${repo.owner.login}/${repo.name}: failed to apply ${change.id}: ${error.message}`)
      results.push({ change, status: 'failed', error })
    }
  }
  return results
}

module.exports = {
  applyChange,
  applyChanges,
  hasClosedUnmergedPullRequest,
}
