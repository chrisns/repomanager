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

const fetchExistingBranchProtection = async (octokit, owner, repo, branch) => {
  try {
    const { data } = await octokit.rest.repos.getBranchProtection({ owner, repo, branch })
    return data
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// GitHub returns branch-protection state under nested objects with keys like
// `enabled` / `users` / `teams` / `apps` that we never declared. Compare the
// fields we care about by name, with subset semantics: every value we asked
// for must already be set on the server. Anything extra the server keeps is
// fine.
const branchProtectionMatches = (existing, desired) => {
  if (!existing) return false
  const required = desired.required_status_checks
  const got = existing.required_status_checks
  if (required) {
    if (!got) return false
    if (required.strict !== undefined && got.strict !== required.strict) return false
    if (Array.isArray(required.contexts)) {
      const gotContexts = Array.isArray(got.contexts)
        ? got.contexts
        : (got.checks || []).map((c) => c.context)
      const expected = [...required.contexts].sort()
      const actual = [...new Set(gotContexts)].sort()
      if (expected.length !== actual.length) return false
      if (!expected.every((c, i) => c === actual[i])) return false
    }
  }
  if (
    desired.required_linear_history !== undefined &&
    !!(existing.required_linear_history && existing.required_linear_history.enabled) !==
      !!desired.required_linear_history
  )
    return false
  if (
    desired.enforce_admins !== undefined &&
    !!(existing.enforce_admins && existing.enforce_admins.enabled) !== !!desired.enforce_admins
  )
    return false
  // restrictions: null in our config means "no restrictions"; GitHub omits
  // the key entirely when none are set.
  if (desired.restrictions === null && existing.restrictions) return false
  // required_pull_request_reviews: null in our config means "do not require
  // PR reviews via the legacy branch-protection API"; we leave that to
  // rulesets. GitHub omits the key when unset.
  if (desired.required_pull_request_reviews === null && existing.required_pull_request_reviews)
    return false
  return true
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
    const existing = await fetchExistingBranchProtection(
      octokit,
      repo.owner.login,
      repo.name,
      branch,
    )
    if (branchProtectionMatches(existing, config)) continue
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

// True when `actual` contains every key/value declared in `expected`. Arrays
// must match length and order; primitives must be strictly equal. Used to
// compare a stored ruleset against the one we want — GitHub adds default
// fields server-side (e.g. required_reviewers: [], allowed_merge_methods)
// that our config never declared, so a strict deep-equal would diff forever.
const matchesShape = (actual, expected) => {
  if (expected === null || expected === undefined) return actual == expected
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    if (actual.length !== expected.length) return false
    return expected.every((e, i) => matchesShape(actual[i], e))
  }
  if (typeof expected === 'object') {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false
    return Object.keys(expected).every((k) => matchesShape(actual[k], expected[k]))
  }
  return actual === expected
}

const rulesetEquals = (existing, desired) => {
  if (!existing || !desired) return false
  if (existing.enforcement !== desired.enforcement) return false
  if (existing.target !== desired.target) return false
  const exRules = existing.rules || []
  const dRules = desired.rules || []
  if (exRules.length !== dRules.length) return false
  // Each desired rule must match some existing rule of the same type — using
  // subset semantics on parameters so GitHub's server-side defaults don't
  // make the comparison flip permanently.
  const used = new Set()
  for (const dr of dRules) {
    const idx = exRules.findIndex(
      (er, i) =>
        !used.has(i) &&
        er.type === dr.type &&
        matchesShape(er.parameters || {}, dr.parameters || {}),
    )
    if (idx === -1) return false
    used.add(idx)
  }
  // bypass_actors: every desired entry must be present in existing.
  const exBypass = existing.bypass_actors || []
  for (const db of desired.bypass_actors || []) {
    if (!exBypass.some((eb) => matchesShape(eb, db))) return false
  }
  return true
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

const fetchRepoSettings = async (octokit, owner, repo) => {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo })
    return data
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

const repoSettingsMatch = (actual, desiredRepo) => {
  if (!actual) return false
  return Object.entries(desiredRepo).every(([k, v]) => actual[k] === v)
}

const planRepoUpdate = async (octokit, repo, desired) => {
  if (!desired.repo || Object.keys(desired.repo).length === 0) return []
  // The repo object passed in (from eachRepository) often lacks merge-method
  // toggles (allow_squash_merge etc.), so fetch the full record. If the GET
  // fails, fall back to assuming drift — better to propose a no-op apply
  // than silently miss real drift.
  const actual = await fetchRepoSettings(octokit, repo.owner.login, repo.name)
  if (repoSettingsMatch(actual, desired.repo)) return []
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

const resolveFileVisibility = (filesConfig, repoVisibility) => {
  if (!filesConfig || filesConfig === false) return null
  const resolved = {}
  for (const [path, entry] of Object.entries(filesConfig)) {
    if (typeof entry === 'string') {
      resolved[path] = entry
    } else if (entry && typeof entry === 'object') {
      if (!entry.visibility || entry.visibility === repoVisibility) {
        resolved[path] = entry.content
      }
    }
  }
  return Object.keys(resolved).length ? resolved : null
}

const fetchFileContent = async (octokit, owner, repo, path, ref) => {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref })
    if (Array.isArray(data) || data.type !== 'file') return null
    if (typeof data.content !== 'string') return null
    return Buffer.from(data.content, 'base64').toString('utf8')
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

const planFiles = async (octokit, repo, desired) => {
  if (!desired.files || desired.files === false) return []
  const visibility = repo.private ? 'private' : repo.visibility || 'public'
  const filtered = resolveFileVisibility(desired.files, visibility)
  if (!filtered) return []
  const ref = repo.default_branch
  // Compare each desired file against what's on the default branch. Drift if
  // any file is missing or differs. Don't block creation of the consent
  // change on a single file fetch failing — fail open by treating an unknown
  // path as drift, otherwise we silently miss real templated-file rot.
  let drift = false
  for (const [path, content] of Object.entries(filtered)) {
    let actual
    try {
      actual = await fetchFileContent(octokit, repo.owner.login, repo.name, path, ref)
    } catch {
      drift = true
      break
    }
    if (actual === null || actual !== content) {
      drift = true
      break
    }
  }
  if (!drift) return []
  const names = Object.keys(filtered)
  return [
    {
      kind: 'files',
      id: 'files:pr',
      summary: `Open PR to update templated files (${names.join(', ')})`,
      files: filtered,
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
  changes.push(...(await planRepoUpdate(octokit, repo, desired)))
  changes.push(...(await planFiles(octokit, repo, desired)))

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
  planFiles,
  resolveFileVisibility,
  splitByRisk,
  resolveBranchName,
  LOW_RISK_KINDS,
}
