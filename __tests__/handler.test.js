process.env.APP_ID = 'test'
process.env.CERT = 'test'
process.env.GITHUB_WEBHOOK_SECRET = 'test'

jest.mock('../src/octokit', () => {
  const state = {
    iteratorRepos: [],
    octokit: null,
    verifyShouldThrow: false,
  }
  const webhooks = {
    handlers: new Map(),
    on(name, fn) {
      this.handlers.set(name, fn)
    },
    async verifyAndReceive({ name, payload }) {
      if (state.verifyShouldThrow) throw new Error('bad signature')
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
      const keys = [name, parsed.action ? `${name}.${parsed.action}` : null].filter(Boolean)
      for (const key of keys) {
        const fn = this.handlers.get(key)
        if (fn) await fn({ octokit: state.octokit, payload: parsed })
      }
    },
  }
  const eachRepository = {
    iterator() {
      const repos = state.iteratorRepos
      const oct = state.octokit
      return (async function* () {
        for (const repository of repos) yield { octokit: oct, repository }
      })()
    },
  }
  return {
    createApp: jest.fn(async () => ({ webhooks, eachRepository })),
    __state: state,
    __webhooks: webhooks,
  }
})

const {
  processRepo,
  applyConsentedChanges,
  handlePush,
  handleInstallation,
  cron,
  webhook,
} = require('../handler')
const mockedOctokitModule = require('../src/octokit')
const { createMockOctokit, makeRepo } = require('./helpers')

const base64 = (str) => Buffer.from(str).toString('base64')

describe('processRepo', () => {
  it('applies low-risk changes immediately', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })

    const result = await processRepo(octokit, makeRepo())
    expect(result.applied).toBeGreaterThan(0)
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalled()
  })

  it('opens a consent issue for high-risk changes instead of applying', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
      '    required_status_checks:',
      '      strict: true',
      '      contexts:',
      '        - build',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.issues.getLabel.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))

    const result = await processRepo(octokit, makeRepo())
    expect(result.pendingConsent).toBeGreaterThan(0)
    expect(octokit.rest.issues.create).toHaveBeenCalled()
    expect(octokit.rest.repos.updateBranchProtection).not.toHaveBeenCalled()
  })

  it('opens an invalid-config issue when repo-config fails validation', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64('vulnerabilityAlerts: "nope"') } })
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.issues.getLabel.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))

    const result = await processRepo(octokit, makeRepo())
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('invalid-config')
    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('invalid') }),
    )
  })

  it('skips archived repositories', async () => {
    const octokit = createMockOctokit()
    const result = await processRepo(octokit, makeRepo({ archived: true }))
    expect(result.skipped).toBe(true)
    expect(octokit.rest.repos.getContent).not.toHaveBeenCalled()
  })
})

describe('applyConsentedChanges', () => {
  it('applies only the checked items', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
      '    required_status_checks:',
      '      strict: true',
      '      contexts:',
      '        - build',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })

    const issue = {
      number: 9,
      body: '- [x] <!-- repomanager:bp:main --> Apply branch protection to `main`',
    }
    octokit.rest.issues.get.mockResolvedValue({ data: { number: 9, body: issue.body } })
    const result = await applyConsentedChanges(octokit, makeRepo(), issue)
    expect(result.applied).toBe(1)
    expect(octokit.rest.repos.updateBranchProtection).toHaveBeenCalled()
  })

  it('applies nothing when no boxes are ticked', async () => {
    const octokit = createMockOctokit()
    const result = await applyConsentedChanges(octokit, makeRepo(), { number: 1, body: '- [ ] a' })
    expect(result.applied).toBe(0)
  })
})

describe('cron', () => {
  it('iterates over each repository and processes it', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('nf'), { status: 404 }),
    )
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.iteratorRepos = [makeRepo(), makeRepo({ name: 'two' })]
    const result = await cron()
    expect(result.processed).toBe(2)
    expect(result.failed).toBe(0)
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalledTimes(2)
  })

  it('counts failures without aborting the loop', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(new Error('boom'))
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.iteratorRepos = [makeRepo()]
    const result = await cron()
    expect(result.processed + result.failed).toBe(1)
  })
})

describe('webhook entry', () => {
  it('returns 202 on a successful receive', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('nf'), { status: 404 }),
    )
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.verifyShouldThrow = false

    const result = await webhook({
      headers: {
        'x-hub-signature-256': 'sha256=ignored-by-mock',
        'x-github-delivery': 'delivery-1',
        'x-github-event': 'push',
      },
      body: JSON.stringify({
        repository: makeRepo(),
        commits: [{ added: [], modified: ['.github/repo-config.yml'], removed: [] }],
      }),
    })
    expect(result.statusCode).toBe(202)
  })

  it('returns 400 when signature verification fails', async () => {
    mockedOctokitModule.__state.verifyShouldThrow = true
    const result = await webhook({ headers: {}, body: '{}' })
    expect(result.statusCode).toBe(400)
    mockedOctokitModule.__state.verifyShouldThrow = false
  })

  it('handles issues.edited consent events through the webhook dispatcher', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
      '    required_status_checks:',
      '      strict: true',
      '      contexts:',
      '        - build',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })
    octokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 9,
        body: '- [x] <!-- repomanager:bp:main --> Apply BP',
      },
    })
    mockedOctokitModule.__state.octokit = octokit

    await webhook({
      headers: {
        'x-hub-signature-256': 'sha256=ignored',
        'x-github-delivery': 'd2',
        'x-github-event': 'issues',
      },
      body: JSON.stringify({
        action: 'edited',
        issue: {
          number: 9,
          title: 'repomanager: changes awaiting approval',
          body: '- [x] <!-- repomanager:bp:main --> Apply BP',
          labels: [{ name: 'repomanager:consent' }],
        },
        repository: makeRepo(),
      }),
    })
    expect(octokit.rest.repos.updateBranchProtection).toHaveBeenCalled()
  })
})

describe('handleInstallation', () => {
  it('processes each repository in the installation payload', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('nf'), { status: 404 }),
    )
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    await handleInstallation(octokit, {
      installation: { account: { login: 'test-owner' } },
      repositories: [{ name: 'a' }, { name: 'b' }],
    })
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalledTimes(2)
  })
})

describe('handlePush', () => {
  it('ignores pushes that do not touch repo-config.yml', async () => {
    const octokit = createMockOctokit()
    await handlePush(octokit, {
      repository: makeRepo(),
      commits: [{ added: [], modified: ['src/foo.js'], removed: [] }],
    })
    expect(octokit.rest.repos.getContent).not.toHaveBeenCalled()
  })

  it('triggers a re-plan when .github/repo-config.yml changes', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    await handlePush(octokit, {
      repository: makeRepo(),
      commits: [{ added: [], modified: ['.github/repo-config.yml'], removed: [] }],
    })
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalled()
  })
})
