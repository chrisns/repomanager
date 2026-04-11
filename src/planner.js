const LOW_RISK_KINDS = new Set([
  'vulnerabilityAlerts',
  'automatedSecurityFixes',
  'secretScanning',
  'secretScanningPushProtection',
  'privateVulnerabilityReporting',
  'dependabotSecurityUpdates',
])

const resolveBranchName = (branch, defaultBranch) =>
  branch === '__DEFAULT_BRANCH__' ? defaultBranch : branch

const expandAllContexts = async (octokit, owner, repo, branch) => {
  try {
    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
    })
    return Array.from(new Set(data.check_runs.map((c) => c.name)))
  } catch {
    return []
  }
}

const planBranchProtection = async (octokit, repo, desired) => {
  const changes = []
  for (const bp of desired) {
    const branch = resolveBranchName(bp.branch, repo.default_branch)
    if (!branch) continue
    const config = { ...bp, branch }
    if (config.required_status_checks && config.required_status_checks.contexts === 'ALL') {
      config.required_status_checks = {
        ...config.required_status_checks,
        contexts: await expandAllContexts(octokit, repo.owner.login, repo.name, branch),
      }
    }
    changes.push({
      kind: 'branchProtection',
      id: `bp:${branch}`,
      branch,
      summary: `Apply branch protection to \`${branch}\``,
      config,
      riskLevel: 'high',
    })
  }
  return changes
}

const rulesetEquals = (a, b) => {
  if (!a || !b) return false
  if (a.enforcement !== b.enforcement) return false
  if (a.target !== b.target) return false
  try {
    return JSON.stringify(a.rules || []) === JSON.stringify(b.rules || [])
  } catch {
    return false
  }
}

const planRulesets = async (octokit, repo, desired) => {
  const changes = []
  let existing = []
  try {
    existing = await octokit.paginate(octokit.rest.repos.getRepoRulesets, {
      owner: repo.owner.login,
      repo: repo.name,
    })
  } catch (error) {
    if (error.status !== 404) throw error
  }

  for (const rs of desired) {
    const matching = existing.find((e) => e.name === rs.name)
    if (!matching) {
      changes.push({
        kind: 'ruleset',
        id: `ruleset:create:${rs.name}`,
        summary: `Create ruleset \`${rs.name}\``,
        ruleset: rs,
        action: 'create',
        riskLevel: 'high',
      })
      continue
    }
    let fullExisting = matching
    try {
      fullExisting = (
        await octokit.rest.repos.getRepoRuleset({
          owner: repo.owner.login,
          repo: repo.name,
          ruleset_id: matching.id,
        })
      ).data
    } catch {
      // fall back to list view
    }
    if (!rulesetEquals(fullExisting, rs)) {
      changes.push({
        kind: 'ruleset',
        id: `ruleset:update:${rs.name}`,
        summary: `Update ruleset \`${rs.name}\``,
        ruleset: rs,
        rulesetId: matching.id,
        action: 'update',
        riskLevel: 'high',
      })
    }
  }
  return changes
}

const planSimpleFlag = (key, desired, summary) =>
  desired[key] === undefined
    ? []
    : [
        {
          kind: key,
          id: key,
          summary,
          value: desired[key],
          riskLevel: 'low',
        },
      ]

const planRepoUpdate = (desired) => {
  if (!desired.repo || Object.keys(desired.repo).length === 0) return []
  return [
    {
      kind: 'repo',
      id: 'repo:update',
      summary: `Update repository settings (${Object.keys(desired.repo).join(', ')})`,
      config: desired.repo,
      riskLevel: 'high',
    },
  ]
}

const planFiles = (desired) => {
  if (!desired.files || desired.files === false) return []
  const names = Object.keys(desired.files)
  if (names.length === 0) return []
  return [
    {
      kind: 'files',
      id: 'files:pr',
      summary: `Open PR to update templated files (${names.join(', ')})`,
      files: desired.files,
      riskLevel: 'high',
    },
  ]
}

const planRepo = async (octokit, repo, desired) => {
  const changes = []
  changes.push(
    ...planSimpleFlag('vulnerabilityAlerts', desired, `Set vulnerability alerts to ${desired.vulnerabilityAlerts}`),
  )
  changes.push(
    ...planSimpleFlag(
      'automatedSecurityFixes',
      desired,
      `Set automated security fixes to ${desired.automatedSecurityFixes}`,
    ),
  )
  changes.push(...planSimpleFlag('secretScanning', desired, `Set secret scanning to ${desired.secretScanning}`))
  changes.push(
    ...planSimpleFlag(
      'secretScanningPushProtection',
      desired,
      `Set secret scanning push protection to ${desired.secretScanningPushProtection}`,
    ),
  )
  changes.push(
    ...planSimpleFlag(
      'privateVulnerabilityReporting',
      desired,
      `Set private vulnerability reporting to ${desired.privateVulnerabilityReporting}`,
    ),
  )
  changes.push(
    ...planSimpleFlag(
      'dependabotSecurityUpdates',
      desired,
      `Set dependabot security updates to ${desired.dependabotSecurityUpdates}`,
    ),
  )

  if (desired.branchProtection && repo.default_branch) {
    changes.push(...(await planBranchProtection(octokit, repo, desired.branchProtection)))
  }
  if (desired.rulesets) {
    changes.push(...(await planRulesets(octokit, repo, desired.rulesets)))
  }
  changes.push(...planRepoUpdate(desired))
  changes.push(...planFiles(desired))

  return changes
}

const splitByRisk = (changes) => ({
  autoApply: changes.filter((c) => LOW_RISK_KINDS.has(c.kind)),
  needsConsent: changes.filter((c) => !LOW_RISK_KINDS.has(c.kind)),
})

module.exports = {
  planRepo,
  planBranchProtection,
  planRulesets,
  splitByRisk,
  resolveBranchName,
  LOW_RISK_KINDS,
}
