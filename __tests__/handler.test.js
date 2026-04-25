process.env.APP_ID = 'test'
process.env.CERT = 'test'
process.env.GITHUB_WEBHOOK_SECRET = 'test'
delete process.env.WORKER_FUNCTION_NAME

const mockLambdaSend = jest.fn(async () => ({}))
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}))

jest.mock('../src/octokit', () => {
  const state = {
    iteratorRepos: [],
    reposByInstallation: null,
    installations: [],
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
    iterator(opts) {
      const oct = state.octokit
      const repos =
        opts && opts.installationId && state.reposByInstallation
          ? state.reposByInstallation[opts.installationId] || []
          : state.iteratorRepos
      return (async function* () {
        for (const repository of repos) yield { octokit: oct, repository }
      })()
    },
  }
  const eachInstallation = {
    iterator() {
      const installations = state.installations
      return (async function* () {
        for (const installation of installations) yield { installation }
      })()
    },
  }
  return {
    createApp: jest.fn(async () => ({ webhooks, eachRepository, eachInstallation })),
    __state: state,
    __webhooks: webhooks,
  }
})

const {
  processRepo,
  applyConsentedChanges,
  handlePush,
  handleInstallation,
  cronDispatcher,
  cronWorker,
  webhook,
} = require('../handler')
const mockedOctokitModule = require('../src/octokit')
const { encodeId } = require('../src/consent')
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
      body: `- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply branch protection to \`main\``,
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

  it('skips items that are already struck through (applied)', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })
    const issueBody = `- [x] <!-- repomanager:${encodeId('bp:main')} --> ~~Apply BP~~`
    const result = await applyConsentedChanges(octokit, makeRepo(), { number: 9, body: issueBody })
    expect(result.applied).toBe(0)
    expect(octokit.rest.repos.updateBranchProtection).not.toHaveBeenCalled()
  })

  it('skips items that are unticked even with the ⚠️ marker', async () => {
    const octokit = createMockOctokit()
    const issueBody = `- [ ] <!-- repomanager:${encodeId('bp:main')} --> ⚠️ Apply BP`
    const result = await applyConsentedChanges(octokit, makeRepo(), { number: 9, body: issueBody })
    expect(result.applied).toBe(0)
    expect(octokit.rest.repos.updateBranchProtection).not.toHaveBeenCalled()
  })

  it('retries an item that is re-ticked while still carrying the ⚠️ marker', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })
    const issueBody = `- [x] <!-- repomanager:${encodeId('bp:main')} --> ⚠️ Apply BP`
    octokit.rest.issues.get.mockResolvedValue({
      data: { number: 9, state: 'open', body: issueBody },
    })
    const result = await applyConsentedChanges(octokit, makeRepo(), { number: 9, body: issueBody })
    expect(result.applied).toBe(1)
    expect(octokit.rest.repos.updateBranchProtection).toHaveBeenCalled()
  })

  it('posts a sanitised comment when an apply fails and unticks the box', async () => {
    const octokit = createMockOctokit()
    const repoYaml = [
      'branchProtection:',
      "  - branch: '__DEFAULT_BRANCH__'",
      '    required_linear_history: true',
    ].join('\n')
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })
    const issueBody = `- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply BP`
    octokit.rest.issues.get.mockResolvedValue({
      data: { number: 9, state: 'open', body: issueBody },
    })
    const fakePat = ['gh', 'p', '_', 'a'.repeat(36)].join('')
    octokit.rest.repos.updateBranchProtection.mockRejectedValue(
      new Error(`boom ${fakePat}`),
    )

    const result = await applyConsentedChanges(octokit, makeRepo(), { number: 9, body: issueBody })
    expect(result.failed).toBe(1)
    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1)
    const commentBody = octokit.rest.issues.createComment.mock.calls[0][0].body
    expect(commentBody).toContain('`bp:main`')
    expect(commentBody).not.toContain(fakePat)
    expect(commentBody).toContain('[REDACTED]')
    const updateCall = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 9)
    expect(updateCall[0].body).toContain(`- [ ] <!-- repomanager:${encodeId('bp:main')} --> ⚠️`)
  })
})

describe('cronWorker', () => {
  it('iterates repositories for the given installation and processes each', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('nf'), { status: 404 }),
    )
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.reposByInstallation = {
      42: [makeRepo(), makeRepo({ name: 'two' })],
      99: [makeRepo({ name: 'other' })],
    }
    const result = await cronWorker({ installationId: 42 })
    expect(result.processed).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.installationId).toBe(42)
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalledTimes(2)
  })

  it('counts failures without aborting the loop', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(new Error('boom'))
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.reposByInstallation = { 1: [makeRepo()] }
    const result = await cronWorker({ installationId: 1 })
    expect(result.processed + result.failed).toBe(1)
  })

  it('throws when installationId is missing', async () => {
    await expect(cronWorker({})).rejects.toThrow(/installationId required/)
  })
})

describe('cronDispatcher', () => {
  beforeEach(() => {
    mockLambdaSend.mockClear()
    delete process.env.WORKER_FUNCTION_NAME
    mockedOctokitModule.__state.reposByInstallation = null
    mockedOctokitModule.__state.iteratorRepos = []
  })

  it('inlines the worker per installation when WORKER_FUNCTION_NAME is unset', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('nf'), { status: 404 }),
    )
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    mockedOctokitModule.__state.octokit = octokit
    mockedOctokitModule.__state.installations = [{ id: 42 }, { id: 99 }]
    mockedOctokitModule.__state.reposByInstallation = {
      42: [makeRepo()],
      99: [makeRepo({ name: 'other' }), makeRepo({ name: 'third' })],
    }
    const result = await cronDispatcher()
    expect(result.dispatched).toBe(2)
    expect(octokit.rest.repos.enableVulnerabilityAlerts).toHaveBeenCalledTimes(3)
    expect(mockLambdaSend).not.toHaveBeenCalled()
  })

  it('async-invokes the worker lambda per installation when WORKER_FUNCTION_NAME is set', async () => {
    process.env.WORKER_FUNCTION_NAME = 'repomanager-cron-worker'
    mockedOctokitModule.__state.installations = [{ id: 42 }, { id: 99 }]
    const octokit = createMockOctokit()
    mockedOctokitModule.__state.octokit = octokit

    const result = await cronDispatcher()
    expect(result.dispatched).toBe(2)
    expect(mockLambdaSend).toHaveBeenCalledTimes(2)
    const sentPayloads = mockLambdaSend.mock.calls.map((c) =>
      JSON.parse(Buffer.from(c[0].input.Payload).toString('utf8')),
    )
    expect(sentPayloads).toEqual(
      expect.arrayContaining([{ installationId: 42 }, { installationId: 99 }]),
    )
    expect(mockLambdaSend.mock.calls[0][0].input.FunctionName).toBe('repomanager-cron-worker')
    expect(mockLambdaSend.mock.calls[0][0].input.InvocationType).toBe('Event')
    // Should not have processed repos locally.
    expect(octokit.rest.repos.enableVulnerabilityAlerts).not.toHaveBeenCalled()
  })

  it('logs and continues when a worker invoke fails', async () => {
    process.env.WORKER_FUNCTION_NAME = 'repomanager-cron-worker'
    mockedOctokitModule.__state.installations = [{ id: 42 }, { id: 99 }]
    mockLambdaSend.mockImplementationOnce(() => Promise.reject(new Error('throttled')))
    mockLambdaSend.mockImplementationOnce(() => Promise.resolve({}))
    const result = await cronDispatcher()
    expect(result.dispatched).toBe(2)
    expect(mockLambdaSend).toHaveBeenCalledTimes(2)
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

  it('decodes base64-encoded API Gateway bodies before verifying', async () => {
    const octokit = createMockOctokit()
    mockedOctokitModule.__state.octokit = octokit
    const payload = JSON.stringify({
      repository: makeRepo(),
      commits: [{ added: [], modified: [], removed: [] }],
    })
    const original = mockedOctokitModule.__webhooks.verifyAndReceive
    let received
    mockedOctokitModule.__webhooks.verifyAndReceive = async (args) => {
      received = args
    }
    try {
      const result = await webhook({
        isBase64Encoded: true,
        headers: {
          'x-hub-signature-256': 'sha256=ignored',
          'x-github-delivery': 'd3',
          'x-github-event': 'push',
        },
        body: Buffer.from(payload).toString('base64'),
      })
      expect(result.statusCode).toBe(202)
      expect(received.payload).toBe(payload)
    } finally {
      mockedOctokitModule.__webhooks.verifyAndReceive = original
    }
  })

  it('ignores issues.edited events triggered by the bot itself', async () => {
    const octokit = createMockOctokit()
    mockedOctokitModule.__state.octokit = octokit
    await webhook({
      headers: {
        'x-hub-signature-256': 'sha256=ignored',
        'x-github-delivery': 'd-self',
        'x-github-event': 'issues',
      },
      body: JSON.stringify({
        action: 'edited',
        sender: { login: 'the-repository-manager[bot]', type: 'Bot' },
        issue: {
          number: 9,
          title: 'repomanager: changes awaiting approval',
          body: `- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply BP`,
          labels: [{ name: 'repomanager:consent' }],
        },
        repository: makeRepo(),
      }),
    })
    expect(octokit.rest.repos.updateBranchProtection).not.toHaveBeenCalled()
    expect(octokit.rest.issues.update).not.toHaveBeenCalled()
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
    const bodyText = `- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply BP`
    octokit.rest.issues.get.mockResolvedValue({
      data: { number: 9, body: bodyText },
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
          body: bodyText,
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
