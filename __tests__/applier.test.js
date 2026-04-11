const { applyChanges, applyChange, hasClosedUnmergedPullRequest } = require('../src/applier')
const { createMockOctokit, makeRepo } = require('./helpers')

describe('applyChange', () => {
  it('enables vulnerability alerts', async () => {
    const octokit = createMockOctokit()
    await applyChange(octokit, makeRepo(), { kind: 'vulnerabilityAlerts', value: true })
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalled()
  })

  it('updates security_and_analysis for secretScanning', async () => {
    const octokit = createMockOctokit()
    await applyChange(octokit, makeRepo(), { kind: 'secretScanning', value: true })
    expect(octokit.rest.repos.update).toHaveBeenCalledWith(
      expect.objectContaining({
        security_and_analysis: { secret_scanning: { status: 'enabled' } },
      }),
    )
  })

  it('calls updateBranchProtection with the normalized config', async () => {
    const octokit = createMockOctokit()
    await applyChange(octokit, makeRepo(), {
      kind: 'branchProtection',
      id: 'bp:main',
      config: { branch: 'main', required_status_checks: null },
    })
    expect(octokit.rest.repos.updateBranchProtection).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
      }),
    )
  })

  it('creates or updates rulesets depending on action', async () => {
    const octokit = createMockOctokit()
    await applyChange(octokit, makeRepo(), {
      kind: 'ruleset',
      action: 'create',
      ruleset: { name: 'r' },
    })
    expect(octokit.rest.repos.createRepoRuleset).toHaveBeenCalled()

    await applyChange(octokit, makeRepo(), {
      kind: 'ruleset',
      action: 'update',
      rulesetId: 3,
      ruleset: { name: 'r' },
    })
    expect(octokit.rest.repos.updateRepoRuleset).toHaveBeenCalledWith(
      expect.objectContaining({ ruleset_id: 3 }),
    )
  })

  it('skips templated files PR when a closed unmerged PR already exists', async () => {
    const octokit = createMockOctokit()
    octokit.rest.pulls.list.mockResolvedValue({
      data: [{ state: 'closed', merged_at: null }],
    })
    const result = await applyChange(octokit, makeRepo(), {
      kind: 'files',
      files: { 'README.md': 'hi' },
    })
    expect(result).toEqual({ skipped: true })
    expect(octokit.createPullRequest).not.toHaveBeenCalled()
  })

  it('opens templated files PR when no prior closed-unmerged PR exists', async () => {
    const octokit = createMockOctokit()
    octokit.rest.pulls.list.mockResolvedValue({ data: [] })
    await applyChange(octokit, makeRepo(), {
      kind: 'files',
      files: { 'README.md': 'hi' },
    })
    expect(octokit.createPullRequest).toHaveBeenCalled()
  })
})

describe('applyChanges', () => {
  it('continues after a single failure', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.enableVulnerabilityAlerts.mockRejectedValueOnce(new Error('boom'))
    const results = await applyChanges(octokit, makeRepo(), [
      { kind: 'vulnerabilityAlerts', value: true, id: 'v', summary: 'v' },
      { kind: 'automatedSecurityFixes', value: true, id: 'a', summary: 'a' },
    ])
    expect(results[0].status).toBe('failed')
    expect(results[1].status).toBe('applied')
  })

  it('honours dry-run mode', async () => {
    const octokit = createMockOctokit()
    const results = await applyChanges(
      octokit,
      makeRepo(),
      [{ kind: 'vulnerabilityAlerts', value: true, id: 'v', summary: 'v' }],
      { dryRun: true },
    )
    expect(results[0].status).toBe('dry-run')
    expect(octokit.rest.repos.enableVulnerabilityAlerts).not.toHaveBeenCalled()
  })
})

describe('hasClosedUnmergedPullRequest', () => {
  it('returns false on error', async () => {
    const octokit = createMockOctokit()
    octokit.rest.pulls.list.mockRejectedValue(new Error('nope'))
    expect(await hasClosedUnmergedPullRequest(octokit, makeRepo(), 'b')).toBe(false)
  })
})
