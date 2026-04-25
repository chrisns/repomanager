const { planRepo, splitByRisk, resolveFileVisibility } = require('../src/planner')
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

  it('treats GitHub-injected default rule parameters as a match (no spurious update)', async () => {
    // Real-world: server stores the pull_request rule with extras like
    // required_reviewers: [] and allowed_merge_methods that we never
    // declared; we must not loop the planner into update-forever.
    const octokit = createMockOctokit()
    const desired = {
      name: 'default-branch',
      target: 'branch',
      enforcement: 'active',
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
          },
        },
      ],
    }
    const stored = {
      ...desired,
      rules: [
        {
          type: 'pull_request',
          parameters: {
            ...desired.rules[0].parameters,
            required_reviewers: [],
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
          },
        },
      ],
    }
    octokit.paginate.mockResolvedValue([{ id: 9, name: 'default-branch' }])
    octokit.rest.repos.getRepoRuleset.mockResolvedValue({ data: stored })
    const changes = await planRepo(octokit, makeRepo(), { rulesets: [desired] })
    expect(changes).toEqual([])
  })

  it('plans an update when bypass_actors changes', async () => {
    const octokit = createMockOctokit()
    const stored = {
      name: 'default-branch',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [],
      rules: [{ type: 'deletion' }],
    }
    octokit.paginate.mockResolvedValue([{ id: 9, name: 'default-branch' }])
    octokit.rest.repos.getRepoRuleset.mockResolvedValue({ data: stored })
    const desired = {
      ...stored,
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    }
    const changes = await planRepo(octokit, makeRepo(), { rulesets: [desired] })
    expect(changes).toHaveLength(1)
    expect(changes[0].action).toBe('update')
  })
})

describe('resolveFileVisibility', () => {
  it('passes through plain string entries regardless of visibility', () => {
    const result = resolveFileVisibility({ 'README.md': 'hi' }, 'private')
    expect(result).toEqual({ 'README.md': 'hi' })
  })

  it('includes object entries with matching visibility', () => {
    const files = {
      'LICENSE': { content: 'MIT', visibility: 'public' },
      '.github/FUNDING.yml': { content: 'github: [u]', visibility: 'public' },
    }
    expect(resolveFileVisibility(files, 'public')).toEqual({
      'LICENSE': 'MIT',
      '.github/FUNDING.yml': 'github: [u]',
    })
  })

  it('excludes object entries with non-matching visibility', () => {
    const files = {
      'LICENSE': { content: 'MIT', visibility: 'public' },
      'SECURITY.md': { content: 'sec' },
    }
    expect(resolveFileVisibility(files, 'private')).toEqual({
      'SECURITY.md': 'sec',
    })
  })

  it('includes object entries with no visibility filter', () => {
    const files = {
      'CODEOWNERS': { content: '* @team' },
    }
    expect(resolveFileVisibility(files, 'private')).toEqual({
      'CODEOWNERS': '* @team',
    })
  })

  it('returns null when all files are filtered out', () => {
    const files = {
      'LICENSE': { content: 'MIT', visibility: 'public' },
    }
    expect(resolveFileVisibility(files, 'private')).toBeNull()
  })

  it('returns null for false or empty input', () => {
    expect(resolveFileVisibility(false, 'public')).toBeNull()
    expect(resolveFileVisibility(null, 'public')).toBeNull()
  })
})

describe('planRepo files visibility', () => {
  it('includes public-only files for public repos', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ private: false })
    const changes = await planRepo(octokit, repo, {
      files: {
        'LICENSE': { content: 'MIT', visibility: 'public' },
        'SECURITY.md': 'always',
      },
    })
    const filesChange = changes.find((c) => c.kind === 'files')
    expect(filesChange.files).toEqual({ 'LICENSE': 'MIT', 'SECURITY.md': 'always' })
  })

  it('excludes public-only files for private repos', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ private: true })
    const changes = await planRepo(octokit, repo, {
      files: {
        'LICENSE': { content: 'MIT', visibility: 'public' },
        'SECURITY.md': 'always',
      },
    })
    const filesChange = changes.find((c) => c.kind === 'files')
    expect(filesChange.files).toEqual({ 'SECURITY.md': 'always' })
  })

  it('generates no files change when all files are filtered out', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ private: true })
    const changes = await planRepo(octokit, repo, {
      files: {
        'LICENSE': { content: 'MIT', visibility: 'public' },
      },
    })
    expect(changes.find((c) => c.kind === 'files')).toBeUndefined()
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
