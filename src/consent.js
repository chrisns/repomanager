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

const renderChangeLine = (change, { checked = false, applied = false } = {}) => {
  const box = checked || applied ? '[x]' : '[ ]'
  const text = applied ? `~~${change.summary}~~` : change.summary
  return `- ${box} <!-- ${MARKER_PREFIX}${encodeId(change.id)} --> ${text}`
}

const renderPlan = (changes, { appliedIds = new Set(), checkedIds = new Set() } = {}) => {
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
    const strikeMatch = summary.match(/^~~(.*)~~\s*$/)
    if (strikeMatch) {
      summary = strikeMatch[1]
      applied = true
    }
    items.push({ id: decodeId(match[2]), checked: match[1] === 'x', applied, summary })
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

const findOpenIssueByLabel = async (octokit, owner, repo, label, title) => {
  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      labels: label,
      per_page: 50,
    })
    return data.find((issue) => issue.title === title) || null
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

const findIssueByLabelAnyState = async (octokit, owner, repo, label, title) => {
  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'all',
      labels: label,
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    })
    return data.find((issue) => issue.title === title) || null
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

const upsertConsentIssue = async (octokit, repo, changes) => {
  const owner = repo.owner.login
  const name = repo.name
  await ensureLabel(
    octokit,
    owner,
    name,
    CONSENT_LABEL,
    '0e8a16',
    'repomanager: pending config changes awaiting approval',
  )
  const existing = await findIssueByLabelAnyState(octokit, owner, name, CONSENT_LABEL, ISSUE_TITLE)

  if (!existing) {
    if (!changes.length) return null
    const { data } = await octokit.rest.issues.create({
      owner,
      repo: name,
      title: ISSUE_TITLE,
      body: renderPlan(changes),
      labels: [CONSENT_LABEL],
    })
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

  // Preserve user ticks and applied/strike-through state across updates so
  // periodic cron-driven upserts don't wipe progress the webhook flow has
  // already recorded.
  const previous = new Map(parseAllItems(existing.body).map((i) => [i.id, i]))
  const checkedIds = new Set()
  const appliedIds = new Set()
  let hasUnapplied = false
  for (const c of changes) {
    const prev = previous.get(c.id)
    if (prev && prev.applied) {
      appliedIds.add(c.id)
      continue
    }
    hasUnapplied = true
    if (prev && prev.checked) checkedIds.add(c.id)
  }

  const body = renderPlan(changes, { appliedIds, checkedIds })
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

const markItemsApplied = async (octokit, repo, issueNumber, appliedIds) => {
  const owner = repo.owner.login
  const name = repo.name
  const targetIds = [...appliedIds]
  if (!targetIds.length) return
  for (let attempt = 0; attempt < MARK_APPLIED_MAX_ATTEMPTS; attempt++) {
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo: name,
      issue_number: issueNumber,
    })
    const items = parseAllItems(issue.body)
    const byId = new Map(items.map((i) => [i.id, i]))
    const allStruck = targetIds.every((id) => {
      const item = byId.get(id)
      return !item || item.applied
    })
    if (allStruck) {
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
    for (const id of targetIds) mergedApplied.add(id)
    const mergedChecked = new Set()
    for (const i of items) {
      if (i.checked && !mergedApplied.has(i.id)) mergedChecked.add(i.id)
    }
    const body = renderPlan(changes, { appliedIds: mergedApplied, checkedIds: mergedChecked })
    await octokit.rest.issues.update({ owner, repo: name, issue_number: issueNumber, body })
  }
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
  encodeId,
  decodeId,
  renderPlan,
  parseCheckedItems,
  parseAllItems,
  upsertConsentIssue,
  markItemsApplied,
  openInvalidConfigIssue,
  closeInvalidConfigIssue,
  findOpenIssueByLabel,
}
