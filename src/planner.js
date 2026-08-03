// Auto-applied changes don't go through the consent-issue gate. The repo
// security flags are genuinely low-risk one-API-call toggles. `files` is
// here because the apply doesn't actually mutate the repo — it opens (or
// updates) a `repomanager_files` PR that the user must still review and
// merge before any file content changes. The PR itself is the consent gate.
const LOW_RISK_KINDS = new Set([
  'vulnerabilityAlerts',
  'automatedSecurityFixes',
  'secretScanning',
  'secretScanningPushProtection',
  'privateVulnerabilityReporting',
  'dependabotSecurityUpdates',
  'files',
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

// GitHub 403s `repos/.../rulesets` and `repos/.../branches/.../protection`
// for private repos on the Free plan with "Upgrade to GitHub Pro or make
// this repository public to enable this feature." The bot can't manage
// either on those repos, so we treat the 403 as "skip" rather than drift.
const isRulesetUnavailable = (error) =>
  error &&
  error.status === 403 &&
  /Upgrade to GitHub Pro|make this repository public/i.test(error.message || '')

const fetchExistingBranchProtection = async (octokit, owner, repo, branch) => {
  try {
    const { data } = await octokit.rest.repos.getBranchProtection({ owner, repo, branch })
    return data
  } catch (error) {
    if (error.status === 404) return null
    if (isRulesetUnavailable(error)) {
      // Same Pro-only restriction as rulesets — propagate as a sentinel so
      // the caller can skip this branch entirely instead of surfacing it as
      // drift we can never apply.
      const skip = new Error('branch protection unavailable on this plan')
      skip.skipBranchProtection = true
      throw skip
    }
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
    let existing
    try {
      existing = await fetchExistingBranchProtection(
        octokit,
        repo.owner.login,
        repo.name,
        branch,
      )
    } catch (error) {
      if (error.skipBranchProtection) {
        console.warn(
          `${repo.owner.login}/${repo.name}: branch protection unavailable on this plan; skipping ${branch}`,
        )
        continue
      }
      throw error
    }
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
    if (error.status === 404) {
      // no rulesets endpoint response — fall through to "no existing"
    } else if (isRulesetUnavailable(error)) {
      console.warn(
        `${repo.owner.login}/${repo.name}: rulesets API unavailable (likely a private repo on the Free plan); skipping rulesets for this repo`,
      )
      return []
    } else {
      throw error
    }
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

// These three flags live on their own endpoints rather than in the repo
// record, so knowing whether they're already set costs a GET. That GET
// replaces the write we used to fire unconditionally on every repo on every
// tick — same API budget, but the steady state stops mutating repos that are
// already in the desired state.
const FLAG_CHECKS = {
  vulnerabilityAlerts: async (octokit, args) => {
    try {
      await octokit.rest.repos.checkVulnerabilityAlerts(args)
      return true
    } catch (error) {
      if (error.status === 404) return false
      throw error
    }
  },
  automatedSecurityFixes: async (octokit, args) => {
    try {
      const { data } = await octokit.rest.repos.checkAutomatedSecurityFixes(args)
      return !!data.enabled
    } catch (error) {
      if (error.status === 404) return false
      throw error
    }
  },
  privateVulnerabilityReporting: async (octokit, args) => {
    const { data } = await octokit.rest.repos.checkPrivateVulnerabilityReporting(args)
    return !!data.enabled
  },
}

const planSimpleFlag = async (octokit, repo, key, desired, summary) => {
  if (desired[key] === undefined) return []
  // Private vulnerability reporting is a public-repo feature. Enabling it on a
  // private repo can never succeed, so proposing it every tick is pure churn.
  if (key === 'privateVulnerabilityReporting' && repo.private) return []
  const change = [{ kind: key, id: key, summary, value: desired[key], riskLevel: 'low' }]
  try {
    const actual = await FLAG_CHECKS[key](octokit, { owner: repo.owner.login, repo: repo.name })
    return actual === !!desired[key] ? [] : change
  } catch {
    // Couldn't read actual state — fall back to the old behaviour and let the
    // apply be the idempotent no-op it has always been.
    return change
  }
}

// Config flag -> the key GitHub reports it under in repos.get's
// `security_and_analysis` block. These are the flags we can diff against
// actual state from a single repo GET (the others — vulnerability alerts,
// automated security fixes, private vulnerability reporting — live on separate
// endpoints and stay as unconditional idempotent enables).
const SECURITY_ANALYSIS_KEYS = {
  secretScanning: 'secret_scanning',
  secretScanningPushProtection: 'secret_scanning_push_protection',
  dependabotSecurityUpdates: 'dependabot_security_updates',
}
const SECURITY_ANALYSIS_FLAGS = Object.keys(SECURITY_ANALYSIS_KEYS)

// Like planSimpleFlag, but diffs against the repo's actual security-and-analysis
// state so we don't re-apply a flag that is already in the desired state on
// every single tick. Two behaviours matter for cost:
//   * already-converged → emit nothing (no redundant write).
//   * GitHub omits the feature entirely (e.g. secret scanning on a private repo
//     without Advanced Security) → emit nothing. Re-proposing it is the
//     perpetual "failed to apply secretScanning: not available" loop the worker
//     logs every tick on free-plan repos.
// When we couldn't read actual state (GET failed → actualRepo null) we fail
// open and propose the change as before.
const planSecurityAnalysisFlag = (key, desired, actualRepo, summary) => {
  if (desired[key] === undefined) return []
  const change = [{ kind: key, id: key, summary, value: desired[key], riskLevel: 'low' }]
  if (!actualRepo) return change
  const saa = actualRepo.security_and_analysis
  // No security_and_analysis block at all on a private repo means these
  // features don't exist for it (no Advanced Security). Public repos always
  // report the block, so a missing one there is unexpected — fail open.
  if (!saa) return actualRepo.private ? [] : change
  const field = saa[SECURITY_ANALYSIS_KEYS[key]]
  if (!field) return []
  const enabled = field.status === 'enabled'
  if (enabled === !!desired[key]) return []
  return change
}

const fetchRepoSettings = async (octokit, owner, repo) => {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo })
    return data
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// Some `repo:update` keys are silently ignored by GitHub on certain plans
// (e.g. `allow_auto_merge: true` PATCHes a no-op on private repos that
// aren't on Pro). The PATCH succeeds, the actual stays at the unsupported
// value, the planner re-detects drift, and the bot loops forever opening
// consent issues nobody can satisfy. Skip those keys when the actual state
// proves the constraint is in force.
const isUnattainableSetting = (key, desiredValue, actual, repo) => {
  if (!repo || !repo.private) return false
  // Private repo can't enable auto-merge without Pro/Team/Enterprise. If
  // GitHub kept it false despite our previous attempts, treat it as a fixed
  // ceiling rather than perpetual drift.
  if (key === 'allow_auto_merge' && desiredValue === true && actual === false) {
    return true
  }
  return false
}

const repoSettingsMatch = (actual, desiredRepo, repo) => {
  if (!actual) return false
  return Object.entries(desiredRepo).every(([k, v]) => {
    if (isUnattainableSetting(k, v, actual[k], repo)) return true
    return actual[k] === v
  })
}

const planRepoUpdate = (repo, desired, actual) => {
  if (!desired.repo || Object.keys(desired.repo).length === 0) return []
  // `actual` is the repo record fetched once per plan (planRepo). It is null
  // when the GET failed — fall back to assuming drift, better a no-op apply
  // than silently missing real drift.
  if (repoSettingsMatch(actual, desired.repo, repo)) return []
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

// Returns a per-path metadata map { path: { content, presence } } after
// applying visibility filters. Backwards compatible: string entries become
// `{ content: str, presence: false }`.
const resolveFileVisibility = (filesConfig, repoVisibility) => {
  if (!filesConfig || filesConfig === false) return null
  const resolved = {}
  for (const [path, entry] of Object.entries(filesConfig)) {
    if (typeof entry === 'string') {
      resolved[path] = { content: entry, presence: false }
    } else if (entry && typeof entry === 'object') {
      if (!entry.visibility || entry.visibility === repoVisibility) {
        resolved[path] = { content: entry.content, presence: !!entry.presence }
      }
    }
  }
  return Object.keys(resolved).length ? resolved : null
}

const renderTemplate = (content) =>
  content.replace(/\{\{year\}\}/g, String(new Date().getUTCFullYear()))

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

// The templated-files fix is delivered as a PR from `repomanager_files`, not
// as a commit to the default branch. So while that PR sits unmerged, diffing
// against the default branch reports the same drift forever and the applier
// force-pushes an identical commit on every tick — the "every repo got pushed
// again" churn. If an open PR already carries exactly what we want, the ball
// is in the human's court and there is nothing for us to do.
const FILES_BRANCH = 'repomanager_files'

const alreadyOnFilesBranch = async (octokit, repo, toWrite) => {
  let open
  try {
    const { data } = await octokit.rest.pulls.list({
      owner: repo.owner.login,
      repo: repo.name,
      head: `${repo.owner.login}:${FILES_BRANCH}`,
      state: 'open',
      per_page: 1,
    })
    open = data && data.length ? data[0] : null
  } catch {
    return false
  }
  if (!open) return false
  for (const [path, content] of Object.entries(toWrite)) {
    let onBranch
    try {
      onBranch = await fetchFileContent(octokit, repo.owner.login, repo.name, path, FILES_BRANCH)
    } catch {
      return false
    }
    if (onBranch !== content) return false
  }
  return true
}

// Decide which files actually need writing. A `presence` file only needs
// writing if missing — and gets `{{year}}` rendered at plan time. A normal
// file needs writing if missing or if content differs. The applier writes
// exactly the map we return; everything else is left alone.
const planFiles = async (octokit, repo, desired) => {
  if (!desired.files || desired.files === false) return []
  const visibility = repo.private ? 'private' : repo.visibility || 'public'
  const filtered = resolveFileVisibility(desired.files, visibility)
  if (!filtered) return []
  const ref = repo.default_branch
  const toWrite = {}
  for (const [path, { content, presence }] of Object.entries(filtered)) {
    let actual
    try {
      actual = await fetchFileContent(octokit, repo.owner.login, repo.name, path, ref)
    } catch {
      // Fail open: treat fetch errors as drift so we don't silently miss
      // real templated-file rot.
      toWrite[path] = presence ? renderTemplate(content) : content
      continue
    }
    if (presence) {
      if (actual === null) toWrite[path] = renderTemplate(content)
      // else: file exists, hands off
    } else {
      if (actual === null || actual !== content) toWrite[path] = content
    }
  }
  if (!Object.keys(toWrite).length) return []
  if (await alreadyOnFilesBranch(octokit, repo, toWrite)) return []
  const names = Object.keys(toWrite)
  return [
    {
      kind: 'files',
      id: 'files:pr',
      summary: `Open PR to update templated files (${names.join(', ')})`,
      files: toWrite,
      riskLevel: 'high',
    },
  ]
}

const planRepo = async (octokit, repo, desired) => {
  const changes = []

  // Fetch the repo record at most once per plan — both the security-and-
  // analysis flag diff and planRepoUpdate read from it. Reusing one GET avoids
  // a second round-trip and, more importantly, lets us skip the redundant
  // writes that already-converged security flags would otherwise fire on every
  // tick (the bulk of steady-state cron cost). Any GET failure → null → the
  // diffs fail open and behave as before.
  const needsRepoRecord =
    SECURITY_ANALYSIS_FLAGS.some((k) => desired[k] !== undefined) ||
    (desired.repo && Object.keys(desired.repo).length > 0)
  const actualRepo = needsRepoRecord
    ? await fetchRepoSettings(octokit, repo.owner.login, repo.name).catch(() => null)
    : null

  changes.push(
    ...(await planSimpleFlag(
      octokit,
      repo,
      'vulnerabilityAlerts',
      desired,
      `Set vulnerability alerts to ${desired.vulnerabilityAlerts}`,
    )),
  )
  changes.push(
    ...(await planSimpleFlag(
      octokit,
      repo,
      'automatedSecurityFixes',
      desired,
      `Set automated security fixes to ${desired.automatedSecurityFixes}`,
    )),
  )
  changes.push(
    ...planSecurityAnalysisFlag('secretScanning', desired, actualRepo, `Set secret scanning to ${desired.secretScanning}`),
  )
  changes.push(
    ...planSecurityAnalysisFlag(
      'secretScanningPushProtection',
      desired,
      actualRepo,
      `Set secret scanning push protection to ${desired.secretScanningPushProtection}`,
    ),
  )
  changes.push(
    ...(await planSimpleFlag(
      octokit,
      repo,
      'privateVulnerabilityReporting',
      desired,
      `Set private vulnerability reporting to ${desired.privateVulnerabilityReporting}`,
    )),
  )
  changes.push(
    ...planSecurityAnalysisFlag(
      'dependabotSecurityUpdates',
      desired,
      actualRepo,
      `Set dependabot security updates to ${desired.dependabotSecurityUpdates}`,
    ),
  )

  if (desired.branchProtection && repo.default_branch) {
    changes.push(...(await planBranchProtection(octokit, repo, desired.branchProtection)))
  }
  if (desired.rulesets) {
    changes.push(...(await planRulesets(octokit, repo, desired.rulesets)))
  }
  changes.push(...planRepoUpdate(repo, desired, actualRepo))
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
