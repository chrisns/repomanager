const CONSENT_LABEL = 'repomanager:consent'
const INVALID_CONFIG_LABEL = 'repomanager:invalid-config'
const ISSUE_TITLE = 'repomanager: changes awaiting approval'
const INVALID_TITLE = 'repomanager: invalid repo-config.yml'
const MARKER_PREFIX = 'repomanager:'
const HEADER = '<!-- repomanager:plan v1 -->'

const encodeId = (id) => id.replace(/-->/g, '-- >')

const renderChangeLine = (change, checked = false) => {
  const box = checked ? '[x]' : '[ ]'
  return `- ${box} <!-- ${MARKER_PREFIX}${encodeId(change.id)} --> ${change.summary}`
}

const renderPlan = (changes, { appliedIds = new Set() } = {}) => {
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
    lines.push(renderChangeLine(change, appliedIds.has(change.id)))
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('_Close this issue to dismiss the plan. It will be reopened on the next drift detection._')
  return lines.join('\n')
}

const parseCheckedItems = (body) => {
  if (!body) return new Set()
  const checked = new Set()
  const regex = /^- \[x\]\s*<!--\s*repomanager:([^\s]+)\s*-->/gim
  let match
  while ((match = regex.exec(body)) !== null) {
    checked.add(match[1])
  }
  return checked
}

const parseAllItems = (body) => {
  if (!body) return []
  const items = []
  const regex = /^- \[(x| )\]\s*<!--\s*repomanager:([^\s]+)\s*-->\s*(.*)$/gim
  let match
  while ((match = regex.exec(body)) !== null) {
    items.push({ id: match[2], checked: match[1] === 'x', summary: match[3] })
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
  const existing = await findOpenIssueByLabel(octokit, owner, name, CONSENT_LABEL, ISSUE_TITLE)
  const body = renderPlan(changes)

  if (!existing) {
    if (!changes.length) return null
    const { data } = await octokit.rest.issues.create({
      owner,
      repo: name,
      title: ISSUE_TITLE,
      body,
      labels: [CONSENT_LABEL],
    })
    return data
  }

  if (!changes.length) {
    await octokit.rest.issues.update({
      owner,
      repo: name,
      issue_number: existing.number,
      state: 'closed',
      state_reason: 'completed',
    })
    return existing
  }

  await octokit.rest.issues.update({
    owner,
    repo: name,
    issue_number: existing.number,
    body,
  })
  return existing
}

const markItemsApplied = async (octokit, repo, issueNumber, appliedIds) => {
  const owner = repo.owner.login
  const name = repo.name
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo: name,
    issue_number: issueNumber,
  })
  const items = parseAllItems(issue.body)
  const updatedItems = items.map((i) => (appliedIds.has(i.id) ? { ...i, checked: true } : i))
  const changes = updatedItems.map((i) => ({ id: i.id, summary: i.summary }))
  const body = renderPlan(
    changes,
    { appliedIds: new Set(updatedItems.filter((i) => i.checked).map((i) => i.id)) },
  )
  await octokit.rest.issues.update({ owner, repo: name, issue_number: issueNumber, body })
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
  renderPlan,
  parseCheckedItems,
  parseAllItems,
  upsertConsentIssue,
  markItemsApplied,
  openInvalidConfigIssue,
  closeInvalidConfigIssue,
  findOpenIssueByLabel,
}
