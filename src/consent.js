const CONSENT_LABEL = 'repomanager:consent'
const INVALID_CONFIG_LABEL = 'repomanager:invalid-config'
const ISSUE_TITLE = 'repomanager: changes awaiting approval'
const INVALID_TITLE = 'repomanager: invalid repo-config.yml'
const MARKER_PREFIX = 'repomanager:'
const HEADER = '<!-- repomanager:plan v1 -->'

// Percent-encode the id so no `--` (and therefore no `-->` / `--!>` comment
// end sequence) can appear inside the embedded HTML comment. encodeURIComponent
// leaves `-` alone so we swap it explicitly; decodeURIComponent handles `%2D`.
const encodeId = (id) => encodeURIComponent(id).replace(/-/g, '%2D')
const decodeId = (encoded) => decodeURIComponent(encoded)

const WARNING_MARKER = '⚠️'

const renderChangeLine = (
  change,
  { checked = false, applied = false, failed = false } = {},
) => {
  let box = '[ ]'
  let text = change.summary
  if (applied) {
    box = '[x]'
    text = `~~${change.summary}~~`
  } else if (failed) {
    // Failed apply: untick the box so the user has to explicitly retry, and
    // prepend a warning so it's obvious which item needs attention.
    text = `${WARNING_MARKER} ${change.summary}`
  } else if (checked) {
    box = '[x]'
  }
  return `- ${box} <!-- ${MARKER_PREFIX}${encodeId(change.id)} --> ${text}`
}

const renderPlan = (
  changes,
  { appliedIds = new Set(), checkedIds = new Set(), failedIds = new Set() } = {},
) => {
  if (!changes.length) {
    return `${HEADER}\n\nNo pending changes. repomanager is happy. ✨\n`
  }
  const lines = [
    HEADER,
    '',
    '**repomanager** has detected configuration drift on this repository.',
    '',
    'Tick the boxes below to apply each change. Untick to ignore for now.',
    '',
    '| Kind | Changes |',
    '| --- | --- |',
  ]
  const byKind = new Map()
  for (const c of changes) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, [])
    byKind.get(c.kind).push(c)
  }
  for (const [kind, items] of byKind) {
    lines.push(`| \`${kind}\` | ${items.length} |`)
  }
  lines.push('')
  lines.push('## Proposed changes')
  lines.push('')
  for (const change of changes) {
    lines.push(
      renderChangeLine(change, {
        applied: appliedIds.has(change.id),
        checked: checkedIds.has(change.id),
        failed: failedIds.has(change.id),
      }),
    )
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('_Close this issue to dismiss the plan. It will be reopened on the next drift detection._')
  return lines.join('\n')
}

// Matches the output of encodeURIComponent (with `-` → `%2D`). The set
// deliberately excludes literal `-` so no hyphen pair can terminate the
// surrounding HTML comment prematurely.
const ID_CHARS = "[A-Za-z0-9_.!~*'()%]+"

const parseCheckedItems = (body) => {
  if (!body) return new Set()
  const checked = new Set()
  const regex = new RegExp(`^- \\[x\\]\\s*<!--\\s*repomanager:(${ID_CHARS})\\s*-->`, 'gim')
  let match
  while ((match = regex.exec(body)) !== null) {
    checked.add(decodeId(match[1]))
  }
  return checked
}

const parseAllItems = (body) => {
  if (!body) return []
  const items = []
  const regex = new RegExp(
    `^- \\[(x| )\\]\\s*<!--\\s*repomanager:(${ID_CHARS})\\s*-->\\s*(.*)$`,
    'gim',
  )
  let match
  while ((match = regex.exec(body)) !== null) {
    let summary = match[3]
    let applied = false
    let failed = false
    const strikeMatch = summary.match(/^~~(.*)~~\s*$/)
    if (strikeMatch) {
      summary = strikeMatch[1]
      applied = true
    } else {
      const warnMatch = summary.match(/^⚠️\s+(.*)$/)
      if (warnMatch) {
        summary = warnMatch[1]
        failed = true
      }
    }
    items.push({
      id: decodeId(match[2]),
      checked: match[1] === 'x',
      applied,
      failed,
      summary,
    })
  }
  return items
}

const ensureLabel = async (octokit, owner, repo, name, color, description) => {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name })
  } catch (error) {
    if (error.status !== 404) throw error
    try {
      await octokit.rest.issues.createLabel({ owner, repo, name, color, description })
    } catch (createError) {
      if (createError.status !== 422) throw createError
    }
  }
}

// GitHub's `GET /repos/{owner}/{repo}/issues` endpoint has been observed to
// serve stale or empty cached responses even when matching issues exist —
// every call below is unioned to maximise the chance of finding the canonical
// issue. Without this, a single missed read causes us to create a duplicate
// consent issue on every cron tick.
const collectIssuesByLabel = async (octokit, owner, repo, label, title) => {
  const byNumber = new Map()
  const ingest = (arr) => {
    if (!Array.isArray(arr)) return
    for (const issue of arr) {
      if (!issue || issue.title !== title) continue
      // Search returns PRs too; consent issues are never PRs.
      if (issue.pull_request) continue
      if (!byNumber.has(issue.number)) byNumber.set(issue.number, issue)
    }
  }

  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue label:"${label}"`,
      per_page: 100,
    })
    ingest(data && data.items)
  } catch (error) {
    // Search is best-effort — listForRepo below covers us. Specifically
    // tolerate the secondary-rate-limit 403 we'll definitely hit at scale
    // (search is 30 req/min auth'd) and validation 422s. Anything else we
    // log and keep going rather than crash the whole upsert.
    if (
      error.status !== 404 &&
      error.status !== 403 &&
      error.status !== 422
    ) {
      console.warn(
        `${owner}/${repo}: search lookup failed (${error.status || '?'}): ${error.message}`,
      )
    }
  }

  for (const state of ['open', 'closed']) {
    try {
      const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state,
        labels: label,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
      })
      ingest(data)
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }

  return [...byNumber.values()]
}

// When more than one issue matches, prefer an open one, then the lowest issue
// number (the original — duplicates we created later get closed below).
const pickCanonicalIssue = (issues) => {
  if (!issues.length) return null
  const sorted = [...issues].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'open' ? -1 : 1
    return a.number - b.number
  })
  return sorted[0]
}

const findOpenIssueByLabel = async (octokit, owner, repo, label, title) => {
  const all = await collectIssuesByLabel(octokit, owner, repo, label, title)
  const open = all.filter((i) => i.state === 'open')
  return pickCanonicalIssue(open)
}

const findIssueByLabelAnyState = async (octokit, owner, repo, label, title) => {
  const all = await collectIssuesByLabel(octokit, owner, repo, label, title)
  return pickCanonicalIssue(all)
}

// Close every open issue with the given label/title except `keepNumber`.
// Used after we create a new issue to clean up duplicates that a stale read
// caused us to miss — and any duplicates a concurrent run created. Keeping
// the lowest issue number is deterministic, so concurrent runs converge on
// the same survivor.
const closeDuplicateIssues = async (octokit, owner, repo, label, title, keepNumber) => {
  const all = await collectIssuesByLabel(octokit, owner, repo, label, title)
  const dups = all.filter(
    (i) => i.number !== keepNumber && i.state === 'open',
  )
  for (const dup of dups) {
    try {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: dup.number,
        state: 'closed',
        state_reason: 'not_planned',
      })
    } catch (error) {
      // 404/410 — issue went away. 422 — issue is locked / can't be edited.
      // Either way it isn't an open duplicate any more, log and continue.
      if (
        error.status !== 404 &&
        error.status !== 410 &&
        error.status !== 422
      ) {
        throw error
      }
    }
  }
}

// True when the repo metadata explicitly says issues are turned off, or the
// API has just told us so. Either way we have nowhere to put a consent
// issue, so we skip the whole upsert silently rather than crashing the
// per-repo cron pass.
const issuesDisabled = (repo) => repo && repo.has_issues === false
const isIssuesDisabledError = (error) =>
  error &&
  /Issues has been disabled in this repository/i.test(error.message || '')

const upsertConsentIssue = async (octokit, repo, changes) => {
  const owner = repo.owner.login
  const name = repo.name
  if (issuesDisabled(repo)) return null
  try {
    return await upsertConsentIssueInner(octokit, repo, changes, owner, name)
  } catch (error) {
    if (isIssuesDisabledError(error)) {
      console.warn(`${owner}/${name}: issues disabled, skipping consent issue`)
      return null
    }
    throw error
  }
}

const upsertConsentIssueInner = async (octokit, repo, changes, owner, name) => {
  await ensureLabel(
    octokit,
    owner,
    name,
    CONSENT_LABEL,
    '0e8a16',
    'repomanager: pending config changes awaiting approval',
  )
  // Proactive dedup: every time we touch the consent issue we first union
  // all matching issues (search + open + closed lists) and close every open
  // duplicate above the lowest issue number. This is the bot tidying up
  // after itself across past loops, even on cron ticks where there are no
  // changes to propose.
  const allMatching = await collectIssuesByLabel(
    octokit,
    owner,
    name,
    CONSENT_LABEL,
    ISSUE_TITLE,
  )
  const openMatching = allMatching.filter((i) => i.state === 'open')
  if (openMatching.length > 1) {
    const winner = pickCanonicalIssue(openMatching)
    await closeDuplicateIssues(
      octokit,
      owner,
      name,
      CONSENT_LABEL,
      ISSUE_TITLE,
      winner.number,
    )
    // Reflect the close locally so the picker below sees a single open.
    for (const issue of allMatching) {
      if (issue.state === 'open' && issue.number !== winner.number) {
        issue.state = 'closed'
      }
    }
  }
  const existing = pickCanonicalIssue(allMatching)

  if (!existing) {
    if (!changes.length) return null
    const { data } = await octokit.rest.issues.create({
      owner,
      repo: name,
      title: ISSUE_TITLE,
      body: renderPlan(changes),
      labels: [CONSENT_LABEL],
    })
    // Belt-and-braces: a stale read from the issues index may have hidden
    // an existing issue, or a concurrent run may have created one alongside
    // ours. Re-query and close any open duplicates, keeping the
    // lowest-numbered survivor (deterministic across concurrent runs).
    const allNow = await collectIssuesByLabel(
      octokit,
      owner,
      name,
      CONSENT_LABEL,
      ISSUE_TITLE,
    )
    const openIssues = allNow.filter((i) => i.state === 'open')
    if (openIssues.length > 1) {
      const winner = pickCanonicalIssue(openIssues)
      await closeDuplicateIssues(
        octokit,
        owner,
        name,
        CONSENT_LABEL,
        ISSUE_TITLE,
        winner.number,
      )
      return winner
    }
    return data
  }

  if (!changes.length) {
    if (existing.state === 'open') {
      await octokit.rest.issues.update({
        owner,
        repo: name,
        issue_number: existing.number,
        state: 'closed',
        state_reason: 'completed',
      })
    }
    return existing
  }

  // Preserve user ticks, applied/strike-through and ⚠️ failure state across
  // updates so periodic cron-driven upserts don't wipe progress the webhook
  // flow has already recorded.
  const previous = new Map(parseAllItems(existing.body).map((i) => [i.id, i]))
  const checkedIds = new Set()
  const appliedIds = new Set()
  const failedIds = new Set()
  let hasUnapplied = false
  for (const c of changes) {
    const prev = previous.get(c.id)
    if (prev && prev.applied) {
      appliedIds.add(c.id)
      continue
    }
    hasUnapplied = true
    if (prev && prev.failed) failedIds.add(c.id)
    else if (prev && prev.checked) checkedIds.add(c.id)
  }

  const body = renderPlan(changes, { appliedIds, checkedIds, failedIds })
  const update = { owner, repo: name, issue_number: existing.number, body }

  if (existing.state === 'open' && !hasUnapplied) {
    // Drift plan is fully resolved — close it out.
    update.state = 'closed'
    update.state_reason = 'completed'
  } else if (existing.state === 'closed' && hasUnapplied) {
    // Drift has reoccurred (new id or an item was never applied) — reopen.
    update.state = 'open'
    update.state_reason = 'reopened'
  } else if (existing.state === 'closed' && !hasUnapplied) {
    // All current changes already applied in the closed issue — leave it.
    return existing
  }

  await octokit.rest.issues.update(update)
  return existing
}

// Concurrent issues.edited webhooks (e.g. user ticking two boxes quickly) race
// on read-modify-write of the issue body — last PUT wins, so an earlier
// writer's strike-through gets overwritten. We loop: re-fetch, merge our
// applied ids with any other writer's persisted state, write, and verify on
// the next pass. Convergence is guaranteed because each writer's contribution
// (its appliedIds) is monotonically additive — every retry can only add
// strike-throughs, never remove them.
const MARK_APPLIED_MAX_ATTEMPTS = 5

const markItemsApplied = async (
  octokit,
  repo,
  issueNumber,
  appliedIds,
  failedIds = new Set(),
) => {
  const owner = repo.owner.login
  const name = repo.name
  const appliedTargets = [...appliedIds]
  const failedTargets = [...failedIds].filter((id) => !appliedIds.has(id))
  if (!appliedTargets.length && !failedTargets.length) return
  for (let attempt = 0; attempt < MARK_APPLIED_MAX_ATTEMPTS; attempt++) {
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo: name,
      issue_number: issueNumber,
    })
    const items = parseAllItems(issue.body)
    const byId = new Map(items.map((i) => [i.id, i]))
    const reflected =
      appliedTargets.every((id) => {
        const item = byId.get(id)
        return !item || item.applied
      }) &&
      failedTargets.every((id) => {
        const item = byId.get(id)
        return !item || item.failed
      })
    if (reflected) {
      // Our own writes have landed. If every checkbox is now applied, the
      // consent issue is fully resolved — close it.
      if (
        issue.state === 'open' &&
        items.length &&
        items.every((i) => i.applied)
      ) {
        await octokit.rest.issues.update({
          owner,
          repo: name,
          issue_number: issueNumber,
          state: 'closed',
          state_reason: 'completed',
        })
      }
      return
    }
    const changes = items.map((i) => ({ id: i.id, summary: i.summary }))
    const mergedApplied = new Set(items.filter((i) => i.applied).map((i) => i.id))
    const mergedFailed = new Set(items.filter((i) => i.failed).map((i) => i.id))
    // This round's results take precedence: a successful retry clears any
    // previous ⚠️, a fresh failure clears any previous (stale) applied state.
    for (const id of appliedTargets) {
      mergedApplied.add(id)
      mergedFailed.delete(id)
    }
    for (const id of failedTargets) {
      mergedFailed.add(id)
      mergedApplied.delete(id)
    }
    const mergedChecked = new Set()
    for (const i of items) {
      if (i.checked && !mergedApplied.has(i.id) && !mergedFailed.has(i.id)) {
        mergedChecked.add(i.id)
      }
    }
    const body = renderPlan(changes, {
      appliedIds: mergedApplied,
      checkedIds: mergedChecked,
      failedIds: mergedFailed,
    })
    await octokit.rest.issues.update({ owner, repo: name, issue_number: issueNumber, body })
  }
}

// Strip anything that looks credential-shaped before posting an error message
// to a public issue. Conservative pattern set: GitHub PATs, app tokens, Bearer
// auth, the App's PEM-style cert, anything that names "secret"/"token"/"key"/
// "password" with a value next to it. Errors longer than 4kB are truncated.
const SECRET_PATTERNS = [
  /gh[psour]_[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /Authorization\s*[:=]\s*\S+/gi,
  /-----BEGIN [^-]+-----[\s\S]+?-----END [^-]+-----/g,
  /\b(secret|token|key|password|api[_\-]?key)["'\s:=]+[A-Za-z0-9._\-+/=]{8,}/gi,
]

const sanitizeErrorMessage = (input) => {
  if (input == null) return ''
  let out = String(input)
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]')
  if (out.length > 4000) out = out.slice(0, 4000) + '… (truncated)'
  return out
}

const renderFailureCommentBody = (failures) => {
  const lines = [
    '<!-- repomanager:apply-errors v1 -->',
    '',
    `repomanager hit ${failures.length === 1 ? 'an error' : 'errors'} applying the following — the box${failures.length === 1 ? ' has' : 'es have'} been unticked. Re-tick to retry.`,
    '',
  ]
  for (const f of failures) {
    const id = f.id || (f.change && f.change.id) || 'unknown'
    const summary = f.summary || (f.change && f.change.summary) || ''
    const message = sanitizeErrorMessage(f.error && (f.error.message || f.error))
    lines.push(`### \`${id}\``)
    if (summary) lines.push(`> ${summary}`)
    lines.push('')
    lines.push('```')
    lines.push(message)
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

const postFailureComment = async (octokit, repo, issueNumber, failures) => {
  if (!failures || !failures.length) return
  await octokit.rest.issues.createComment({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: issueNumber,
    body: renderFailureCommentBody(failures),
  })
}

const openInvalidConfigIssue = async (octokit, repo, errors) => {
  const owner = repo.owner.login
  const name = repo.name
  await ensureLabel(
    octokit,
    owner,
    name,
    INVALID_CONFIG_LABEL,
    'd73a4a',
    'repomanager: repo-config.yml failed validation',
  )
  const existing = await findOpenIssueByLabel(octokit, owner, name, INVALID_CONFIG_LABEL, INVALID_TITLE)
  const body = [
    '<!-- repomanager:invalid-config v1 -->',
    '',
    'repomanager could not parse `.github/repo-config.yml`. Fix the following and this issue will close automatically on the next run.',
    '',
    ...errors,
    '',
  ].join('\n')
  if (!existing) {
    const { data } = await octokit.rest.issues.create({
      owner,
      repo: name,
      title: INVALID_TITLE,
      body,
      labels: [INVALID_CONFIG_LABEL],
    })
    return data
  }
  await octokit.rest.issues.update({ owner, repo: name, issue_number: existing.number, body })
  return existing
}

const closeInvalidConfigIssue = async (octokit, repo) => {
  const existing = await findOpenIssueByLabel(
    octokit,
    repo.owner.login,
    repo.name,
    INVALID_CONFIG_LABEL,
    INVALID_TITLE,
  )
  if (!existing) return
  await octokit.rest.issues.update({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: existing.number,
    state: 'closed',
    state_reason: 'completed',
  })
}

module.exports = {
  CONSENT_LABEL,
  INVALID_CONFIG_LABEL,
  ISSUE_TITLE,
  INVALID_TITLE,
  WARNING_MARKER,
  encodeId,
  decodeId,
  renderPlan,
  parseCheckedItems,
  parseAllItems,
  upsertConsentIssue,
  markItemsApplied,
  postFailureComment,
  sanitizeErrorMessage,
  renderFailureCommentBody,
  openInvalidConfigIssue,
  closeInvalidConfigIssue,
  findOpenIssueByLabel,
}
