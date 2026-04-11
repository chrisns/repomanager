const { planRepo, splitByRisk } = require('../src/planner')
const { createMockOctokit, makeRepo } = require('./helpers')

describe('planRepo', () => {
  it('plans low-risk flags', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo()
    const changes = await planRepo(octokit, repo, {
      vulnerabilityAlerts: true,
      automatedSecurityFixes: false,
      secretScanning: true,
    })
    expect(changes.map((c) => c.kind)).toEqual([
      'vulnerabilityAlerts',
      'automatedSecurityFixes',
      'secretScanning',
    ])
    expect(changes.every((c) => c.riskLevel === 'low')).toBe(true)
  })

  it('resolves __DEFAULT_BRANCH__ to the repo default branch', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ default_branch: 'trunk' })
    const changes = await planRepo(octokit, repo, {
      branchProtection: [
        {
          branch: '__DEFAULT_BRANCH__',
          required_status_checks: { strict: true, contexts: ['build'] },
        },
      ],
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].kind).toBe('branchProtection')
    expect(changes[0].branch).toBe('trunk')
    expect(changes[0].config.required_status_checks.contexts).toEqual(['build'])
  })

  it('expands contexts: ALL using checks.listForRef', async () => {
    const octokit = createMockOctokit()
    octokit.rest.checks.listForRef.mockResolvedValue({
      data: { check_runs: [{ name: 'test' }, { name: 'lint' }, { name: 'test' }] },
    })
    const repo = makeRepo()
    const changes = await planRepo(octokit, repo, {
      branchProtection: [
        {
          branch: '__DEFAULT_BRANCH__',
          required_status_checks: { strict: true, contexts: 'ALL' },
        },
      ],
    })
    expect(changes[0].config.required_status_checks.contexts.sort()).toEqual(['lint', 'test'])
  })

  it('works for private repos', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ private: true })
    const changes = await planRepo(octokit, repo, {
      branchProtection: [
        {
          branch: '__DEFAULT_BRANCH__',
          required_status_checks: { strict: true, contexts: ['ci'] },
        },
      ],
    })
    expect(changes).toHaveLength(1)
  })

  it('plans a ruleset create when no matching name exists', async () => {
    const octokit = createMockOctokit()
    octokit.paginate.mockResolvedValue([])
    const repo = makeRepo()
    const changes = await planRepo(octokit, repo, {
      rulesets: [
        {
          name: 'default-branch',
          target: 'branch',
          enforcement: 'active',
          rules: [{ type: 'deletion' }],
        },
      ],
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].action).toBe('create')
  })

  it('plans a ruleset update when the matching ruleset differs', async () => {
    const octokit = createMockOctokit()
    octokit.paginate.mockResolvedValue([{ id: 7, name: 'default-branch' }])
    octokit.rest.repos.getRepoRuleset.mockResolvedValue({
      data: {
        name: 'default-branch',
        target: 'branch',
        enforcement: 'active',
        rules: [],
      },
    })
    const repo = makeRepo()
    const changes = await planRepo(octokit, repo, {
      rulesets: [
        {
          name: 'default-branch',
          target: 'branch',
          enforcement: 'active',
          rules: [{ type: 'deletion' }],
        },
      ],
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].action).toBe('update')
    expect(changes[0].rulesetId).toBe(7)
  })

  it('plans no changes when ruleset matches exactly', async () => {
    const octokit = createMockOctokit()
    const rs = {
      name: 'default-branch',
      target: 'branch',
      enforcement: 'active',
      rules: [{ type: 'deletion' }],
    }
    octokit.paginate.mockResolvedValue([{ id: 9, name: 'default-branch' }])
    octokit.rest.repos.getRepoRuleset.mockResolvedValue({ data: rs })
    const repo = makeRepo()
    const changes = await planRepo(octokit, repo, { rulesets: [rs] })
    expect(changes).toEqual([])
  })
})

describe('splitByRisk', () => {
  it('routes low-risk flags to autoApply and others to needsConsent', () => {
    const changes = [
      { kind: 'vulnerabilityAlerts' },
      { kind: 'branchProtection' },
      { kind: 'repo' },
      { kind: 'secretScanning' },
    ]
    const { autoApply, needsConsent } = splitByRisk(changes)
    expect(autoApply.map((c) => c.kind)).toEqual(['vulnerabilityAlerts', 'secretScanning'])
    expect(needsConsent.map((c) => c.kind)).toEqual(['branchProtection', 'repo'])
  })
})
