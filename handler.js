const { createApp } = require('./src/octokit')
const { getRepoConfig } = require('./src/config')
const { planRepo, splitByRisk } = require('./src/planner')
const { applyChanges } = require('./src/applier')
const {
  upsertConsentIssue,
  parseCheckedItems,
  markItemsApplied,
  openInvalidConfigIssue,
  closeInvalidConfigIssue,
  CONSENT_LABEL,
  ISSUE_TITLE,
} = require('./src/consent')

const isDryRun = () => process.env.DRY_RUN === 'true'

const shouldProcessRepo = (repo) => !repo.fork && !repo.disabled && !repo.archived

const processRepo = async (octokit, repo) => {
  if (!shouldProcessRepo(repo)) return { skipped: true, reason: 'filtered' }

  const { config, errors } = await getRepoConfig(repo.name, repo.owner.login, octokit)
  if (errors) {
    console.warn(`${repo.owner.login}/${repo.name}: invalid repo-config.yml`)
    try {
      await openInvalidConfigIssue(octokit, repo, errors)
    } catch (error) {
      console.error(`${repo.owner.login}/${repo.name}: failed to open invalid-config issue: ${error.message}`)
    }
    return { skipped: true, reason: 'invalid-config' }
  }
  try {
    await closeInvalidConfigIssue(octokit, repo)
  } catch (error) {
    console.warn(`${repo.owner.login}/${repo.name}: could not close invalid-config issue: ${error.message}`)
  }

  if (config.branchProtection && config.branchProtection.length) {
    console.warn(
      `${repo.owner.login}/${repo.name}: \`branchProtection\` is deprecated — prefer the \`rulesets\` key.`,
    )
  }

  const changes = await planRepo(octokit, repo, config)
  if (!changes.length) {
    try {
      await upsertConsentIssue(octokit, repo, [])
    } catch {
      // nothing to clean up
    }
    return { applied: 0, pendingConsent: 0 }
  }

  const { autoApply, needsConsent } = splitByRisk(changes)
  const results = await applyChanges(octokit, repo, autoApply, { dryRun: isDryRun() })

  if (needsConsent.length) {
    if (isDryRun()) {
      console.info(`[dry-run] ${repo.owner.login}/${repo.name}: would upsert consent issue with ${needsConsent.length} item(s)`)
    } else {
      try {
        await upsertConsentIssue(octokit, repo, needsConsent)
      } catch (error) {
        console.error(
          `${repo.owner.login}/${repo.name}: failed to upsert consent issue: ${error.message}`,
        )
      }
    }
  } else {
    try {
      await upsertConsentIssue(octokit, repo, [])
    } catch {
      // ignore
    }
  }

  return { applied: results.length, pendingConsent: needsConsent.length }
}

const cron = async () => {
  const app = await createApp()
  let processed = 0
  let failed = 0
  for await (const { octokit, repository } of app.eachRepository.iterator()) {
    try {
      await processRepo(octokit, repository)
      processed++
    } catch (error) {
      failed++
      console.error(
        `${repository.owner.login}/${repository.name}: unexpected failure: ${error.message}`,
      )
    }
  }
  console.info(`repomanager cron complete. processed=${processed} failed=${failed}`)
  return { processed, failed }
}

const applyConsentedChanges = async (octokit, repo, issue) => {
  const checkedIds = parseCheckedItems(issue.body)
  if (!checkedIds.size) return { applied: 0 }

  const { config, errors } = await getRepoConfig(repo.name, repo.owner.login, octokit)
  if (errors) {
    console.warn(`${repo.owner.login}/${repo.name}: cannot apply consent (invalid config)`)
    return { applied: 0 }
  }
  const changes = await planRepo(octokit, repo, config)
  const toApply = changes.filter((c) => checkedIds.has(c.id))
  if (!toApply.length) return { applied: 0 }

  const results = await applyChanges(octokit, repo, toApply, { dryRun: isDryRun() })
  const appliedIds = new Set(results.filter((r) => r.status === 'applied').map((r) => r.change.id))
  if (appliedIds.size) {
    try {
      await markItemsApplied(octokit, repo, issue.number, appliedIds)
    } catch (error) {
      console.error(
        `${repo.owner.login}/${repo.name}: failed to update consent issue: ${error.message}`,
      )
    }
  }
  return { applied: appliedIds.size }
}

const handleIssuesEdited = async (octokit, payload) => {
  const issue = payload.issue
  if (!issue) return
  if (issue.title !== ISSUE_TITLE) return
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  if (!labels.includes(CONSENT_LABEL)) return
  await applyConsentedChanges(octokit, payload.repository, issue)
}

const handlePush = async (octokit, payload) => {
  const touched = (payload.commits || []).flatMap((c) => [
    ...(c.added || []),
    ...(c.modified || []),
    ...(c.removed || []),
  ])
  const relevant =
    payload.repository.name === '.github'
      ? touched.includes('repo-config.yml')
      : touched.includes('.github/repo-config.yml')
  if (!relevant) return
  await processRepo(octokit, payload.repository)
}

const handleInstallation = async (octokit, payload) => {
  for (const repo of payload.repositories || payload.repositories_added || []) {
    try {
      const fullRepo = { ...repo, owner: payload.installation.account }
      await processRepo(octokit, fullRepo)
    } catch (error) {
      console.error(`installation handler: ${error.message}`)
    }
  }
}

const webhook = async (event) => {
  const app = await createApp()
  app.webhooks.on('issues.edited', ({ octokit, payload }) => handleIssuesEdited(octokit, payload))
  app.webhooks.on('push', ({ octokit, payload }) => handlePush(octokit, payload))
  app.webhooks.on('installation.created', ({ octokit, payload }) => handleInstallation(octokit, payload))
  app.webhooks.on('installation_repositories.added', ({ octokit, payload }) =>
    handleInstallation(octokit, payload),
  )

  const headers = event.headers || {}
  const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256']
  const id = headers['x-github-delivery'] || headers['X-GitHub-Delivery']
  const name = headers['x-github-event'] || headers['X-GitHub-Event']
  const body = event.body || ''

  try {
    await app.webhooks.verifyAndReceive({ id, name, signature, payload: body })
    return { statusCode: 202, body: 'ok' }
  } catch (error) {
    console.error(`webhook verify/receive failed: ${error.message}`)
    return { statusCode: 400, body: `bad webhook: ${error.message}` }
  }
}

module.exports = {
  cron,
  webhook,
  processRepo,
  applyConsentedChanges,
  handleIssuesEdited,
  handlePush,
  handleInstallation,
}
