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

describe('planRulesets graceful degrade', () => {
  it('returns no ruleset changes when GitHub 403s the rulesets API on a private free-plan repo', async () => {
    const octokit = createMockOctokit()
    const upgrade = new Error(
      'Upgrade to GitHub Pro or make this repository public to enable this feature.',
    )
    upgrade.status = 403
    octokit.paginate.mockRejectedValue(upgrade)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const changes = await planRepo(octokit, makeRepo(), {
      rulesets: [
        { name: 'default-branch', target: 'branch', enforcement: 'active', rules: [] },
      ],
    })
    expect(changes.filter((c) => c.kind === 'ruleset')).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('still throws on unrelated 403s', async () => {
    const octokit = createMockOctokit()
    const forbidden = new Error('forbidden for some other reason')
    forbidden.status = 403
    octokit.paginate.mockRejectedValue(forbidden)
    await expect(
      planRepo(octokit, makeRepo(), {
        rulesets: [
          { name: 'default-branch', target: 'branch', enforcement: 'active', rules: [] },
        ],
      }),
    ).rejects.toThrow('forbidden for some other reason')
  })

  it('skips branchProtection silently when GitHub 403s with the same Pro-only message', async () => {
    const octokit = createMockOctokit()
    const upgrade = new Error(
      'Upgrade to GitHub Pro or make this repository public to enable this feature.',
    )
    upgrade.status = 403
    octokit.rest.repos.getBranchProtection.mockRejectedValue(upgrade)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const changes = await planRepo(octokit, makeRepo(), {
      branchProtection: [
        {
          branch: '__DEFAULT_BRANCH__',
          required_status_checks: { strict: false, contexts: ['ci'] },
        },
      ],
    })
    expect(changes.filter((c) => c.kind === 'branchProtection')).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('planRepo drift detection', () => {
  describe('branch protection', () => {
    it('emits no change when existing protection already matches', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.getBranchProtection.mockResolvedValue({
        data: {
          required_status_checks: { strict: false, contexts: ['ci'] },
          required_linear_history: { enabled: true },
          enforce_admins: { enabled: false },
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        branchProtection: [
          {
            branch: '__DEFAULT_BRANCH__',
            required_status_checks: { strict: false, contexts: ['ci'] },
            required_linear_history: true,
            enforce_admins: false,
            restrictions: null,
            required_pull_request_reviews: null,
          },
        ],
      })
      expect(changes.filter((c) => c.kind === 'branchProtection')).toEqual([])
    })

    it('emits a change when no protection exists yet', async () => {
      const octokit = createMockOctokit()
      const changes = await planRepo(octokit, makeRepo(), {
        branchProtection: [
          {
            branch: '__DEFAULT_BRANCH__',
            required_status_checks: { strict: false, contexts: ['ci'] },
            required_linear_history: true,
          },
        ],
      })
      expect(changes.find((c) => c.kind === 'branchProtection')).toBeTruthy()
    })

    it('emits a change when contexts drift', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.getBranchProtection.mockResolvedValue({
        data: {
          required_status_checks: { strict: false, contexts: ['ci', 'lint'] },
          required_linear_history: { enabled: true },
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        branchProtection: [
          {
            branch: '__DEFAULT_BRANCH__',
            required_status_checks: { strict: false, contexts: ['ci'] },
            required_linear_history: true,
          },
        ],
      })
      expect(changes.find((c) => c.kind === 'branchProtection')).toBeTruthy()
    })

    it('treats checks-style contexts (post-deprecation shape) as a match', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.getBranchProtection.mockResolvedValue({
        data: {
          required_status_checks: {
            strict: false,
            checks: [{ context: 'ci' }, { context: 'lint' }],
          },
          required_linear_history: { enabled: true },
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        branchProtection: [
          {
            branch: '__DEFAULT_BRANCH__',
            required_status_checks: { strict: false, contexts: ['ci', 'lint'] },
            required_linear_history: true,
          },
        ],
      })
      expect(changes.filter((c) => c.kind === 'branchProtection')).toEqual([])
    })
  })

  describe('repo settings', () => {
    it('emits no change when actual repo settings already match', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.get.mockResolvedValue({
        data: {
          has_wiki: false,
          allow_squash_merge: true,
          delete_branch_on_merge: true,
          allow_auto_merge: true,
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        repo: {
          has_wiki: false,
          allow_squash_merge: true,
          delete_branch_on_merge: true,
          allow_auto_merge: true,
        },
      })
      expect(changes.filter((c) => c.kind === 'repo')).toEqual([])
    })

    it('emits a change when any desired key drifts', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.get.mockResolvedValue({
        data: { has_wiki: true, allow_squash_merge: true },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        repo: { has_wiki: false, allow_squash_merge: true },
      })
      expect(changes.find((c) => c.kind === 'repo')).toBeTruthy()
    })

    it('ignores extra keys on the actual repo (subset semantics)', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.get.mockResolvedValue({
        data: {
          has_wiki: false,
          allow_squash_merge: true,
          // server-side extras we never declared
          security_and_analysis: { secret_scanning: { status: 'enabled' } },
          topics: ['foo'],
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        repo: { has_wiki: false, allow_squash_merge: true },
      })
      expect(changes.filter((c) => c.kind === 'repo')).toEqual([])
    })

    it('emits drift when the GET fails (fail-open)', async () => {
      const octokit = createMockOctokit()
      // default mock rejects with 404
      const changes = await planRepo(octokit, makeRepo(), {
        repo: { has_wiki: false },
      })
      expect(changes.find((c) => c.kind === 'repo')).toBeTruthy()
    })
  })

  describe('templated files', () => {
    it('emits no change when every desired file matches what is in the repo', async () => {
      const octokit = createMockOctokit()
      const desired = {
        'LICENSE': 'MIT body\n',
        'SECURITY.md': 'sec\n',
      }
      octokit.rest.repos.getContent.mockImplementation(async ({ path }) => ({
        data: {
          type: 'file',
          content: Buffer.from(desired[path], 'utf8').toString('base64'),
        },
      }))
      const changes = await planRepo(octokit, makeRepo(), { files: desired })
      expect(changes.filter((c) => c.kind === 'files')).toEqual([])
    })

    it('emits a change when one file is missing', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.getContent.mockImplementation(async ({ path }) => {
        if (path === 'SECURITY.md') {
          const err = new Error('Not Found')
          err.status = 404
          throw err
        }
        return {
          data: {
            type: 'file',
            content: Buffer.from('MIT body\n', 'utf8').toString('base64'),
          },
        }
      })
      const changes = await planRepo(octokit, makeRepo(), {
        files: {
          'LICENSE': 'MIT body\n',
          'SECURITY.md': 'sec\n',
        },
      })
      expect(changes.find((c) => c.kind === 'files')).toBeTruthy()
    })

    it('emits a change when content differs', async () => {
      const octokit = createMockOctokit()
      octokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('OLD', 'utf8').toString('base64'),
        },
      })
      const changes = await planRepo(octokit, makeRepo(), {
        files: { 'LICENSE': 'NEW' },
      })
      expect(changes.find((c) => c.kind === 'files')).toBeTruthy()
    })
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
