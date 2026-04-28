const {
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
  encodeId,
  CONSENT_LABEL,
  ISSUE_TITLE,
  INVALID_TITLE,
} = require('../src/consent')
const { createMockOctokit, makeRepo, notFoundError } = require('./helpers')

describe('renderPlan', () => {
  it('emits a task list item per change with an encoded stable marker', () => {
    const body = renderPlan([
      { id: 'bp:main', kind: 'branchProtection', summary: 'Apply BP to `main`' },
      { id: 'ruleset:create:default', kind: 'ruleset', summary: 'Create ruleset' },
    ])
    expect(body).toContain(`- [ ] <!-- repomanager:${encodeId('bp:main')} --> Apply BP to \`main\``)
    expect(body).toContain(
      `- [ ] <!-- repomanager:${encodeId('ruleset:create:default')} --> Create ruleset`,
    )
  })

  it('renders empty state when there are no changes', () => {
    expect(renderPlan([])).toMatch(/No pending changes/)
  })
})

describe('renderPlan hyphen regression (CodeQL js/bad-tag-filter)', () => {
  it('neutralises every hyphen pair so no HTML comment-end sequence can form', () => {
    const ids = [
      'bp:feature--x',
      'bp:feature-with-dashes',
      'ruleset:create:weird--name',
      'ruleset:update:other--',
    ]
    const body = renderPlan(ids.map((id) => ({ id, kind: 'ruleset', summary: `Do ${id}` })))

    // For every HTML comment emitted, the interior must not contain `--`
    // which would let browsers close the comment early (`-->`, `--!>`, `--`).
    const markerRegions = body.match(/<!--[^]*?-->/g) || []
    for (const region of markerRegions) {
      const interior = region.slice(4, -3)
      expect(interior).not.toMatch(/--/)
    }

    // And the round-trip decodes back to the original ids
    const parsed = parseAllItems(body)
    expect(parsed.map((i) => i.id).sort()).toEqual([...ids].sort())
  })

  it('parses ticked items whose id contains --', () => {
    const body = renderPlan([{ id: 'feature--branch', kind: 'ruleset', summary: 's' }]).replace(
      '- [ ]',
      '- [x]',
    )
    expect([...parseCheckedItems(body)]).toEqual(['feature--branch'])
  })
})

describe('parseCheckedItems', () => {
  it('returns only ticked ids', () => {
    const mk = (box, id) => `- [${box}] <!-- repomanager:${encodeId(id)} --> ${id}`
    const body = [mk(' ', 'a'), mk('x', 'b'), mk('X', 'c')].join('\n')
    const ids = parseCheckedItems(body)
    expect([...ids].sort()).toEqual(['b', 'c'])
  })
})

describe('parseAllItems', () => {
  it('returns the full set of items and decodes ids back to their raw form', () => {
    const body = [
      `- [ ] <!-- repomanager:${encodeId('a')} --> A`,
      `- [x] <!-- repomanager:${encodeId('bp:main')} --> B`,
      `- [x] <!-- repomanager:${encodeId('done')} --> ~~Done thing~~`,
      `- [ ] <!-- repomanager:${encodeId('errored')} --> ⚠️ Failed thing`,
    ].join('\n')
    const items = parseAllItems(body)
    expect(items).toEqual([
      { id: 'a', checked: false, applied: false, failed: false, summary: 'A' },
      { id: 'bp:main', checked: true, applied: false, failed: false, summary: 'B' },
      { id: 'done', checked: true, applied: true, failed: false, summary: 'Done thing' },
      {
        id: 'errored',
        checked: false,
        applied: false,
        failed: true,
        summary: 'Failed thing',
      },
    ])
  })
})

describe('upsertConsentIssue', () => {
  it('creates a new issue when none exists', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.issues.getLabel.mockRejectedValue(notFoundError())

    const result = await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    expect(octokit.rest.issues.createLabel).toHaveBeenCalled()
    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: ISSUE_TITLE,
        labels: [CONSENT_LABEL],
      }),
    )
    expect(result).toBeTruthy()
  })

  it('updates body when an issue already exists', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 5, title: ISSUE_TITLE, body: 'old' }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'ruleset:create:r', kind: 'ruleset', summary: 'create' },
    ])
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 5,
        body: expect.stringContaining(`repomanager:${encodeId('ruleset:create:r')}`),
      }),
    )
  })

  it('closes the issue when no changes remain', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 5, title: ISSUE_TITLE, state: 'open', body: 'old' }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [])
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 5, state: 'closed' }),
    )
  })

  it('does not re-close an already closed issue when no changes remain', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 5, title: ISSUE_TITLE, state: 'closed', body: 'old' }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [])
    expect(octokit.rest.issues.update).not.toHaveBeenCalled()
  })

  it('skips silently when the repo has issues disabled', async () => {
    const octokit = createMockOctokit()
    const repo = makeRepo({ has_issues: false })
    const result = await upsertConsentIssue(octokit, repo, [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    expect(result).toBeNull()
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
    expect(octokit.rest.issues.listForRepo).not.toHaveBeenCalled()
  })

  it('falls through silently when create errors with the issues-disabled message', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.issues.getLabel.mockRejectedValue(notFoundError())
    octokit.rest.issues.create.mockRejectedValue(
      Object.assign(new Error('Issues has been disabled in this repository.'), {
        status: 410,
      }),
    )
    const result = await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    expect(result).toBeNull()
  })

  it('does not create a new issue when there are no changes', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    const result = await upsertConsentIssue(octokit, makeRepo(), [])
    expect(result).toBeNull()
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
  })

  it('reuses an existing issue surfaced only by the search index', async () => {
    const octokit = createMockOctokit()
    // listForRepo serves a stale empty response (the bug we're guarding
    // against). The search API still has the issue, so we must not create.
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: {
        items: [{ number: 7, title: ISSUE_TITLE, state: 'open', body: 'old' }],
      },
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7 }),
    )
  })

  it('closes pre-existing open duplicates at the start of every upsert', async () => {
    // No new issue is being created here — the upsert finds three open
    // duplicates already in the index and closes the two younger ones,
    // leaving the lowest-numbered as the canonical winner. This is the bot
    // tidying up loops it created previously, even on cron ticks where the
    // changeset is identical to what's already proposed.
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [
        { number: 5, title: ISSUE_TITLE, state: 'open', body: '' },
        { number: 9, title: ISSUE_TITLE, state: 'open', body: '' },
        { number: 12, title: ISSUE_TITLE, state: 'open', body: '' },
      ],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    const closeCalls = octokit.rest.issues.update.mock.calls
      .map((c) => c[0])
      .filter((c) => c.state === 'closed')
    expect(closeCalls.map((c) => c.issue_number).sort((a, b) => a - b)).toEqual([9, 12])
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
  })

  it('closes a duplicate consent issue created racily alongside ours', async () => {
    const octokit = createMockOctokit()
    // First lookup: empty (stale read). After we create, a follow-up lookup
    // surfaces both ours and an older duplicate from a parallel run.
    octokit.rest.issues.listForRepo.mockResolvedValueOnce({ data: [] })
    octokit.rest.issues.listForRepo.mockResolvedValueOnce({ data: [] })
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [
        { number: 42, title: ISSUE_TITLE, state: 'open' },
        { number: 5, title: ISSUE_TITLE, state: 'open' },
      ],
    })
    octokit.rest.issues.create.mockResolvedValue({
      data: { number: 42, title: ISSUE_TITLE, state: 'open' },
    })
    const winner = await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'bp:main', kind: 'branchProtection', summary: 'bp' },
    ])
    expect(winner.number).toBe(5)
    // The duplicate (the higher-numbered one we just created) gets closed.
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, state: 'closed' }),
    )
  })
})

describe('markItemsApplied', () => {
  it('strikes through applied items and leaves untouched items alone', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 7,
        body: [
          `- [x] <!-- repomanager:${encodeId('a')} --> A`,
          `- [ ] <!-- repomanager:${encodeId('b')} --> B`,
          `- [x] <!-- repomanager:${encodeId('c')} --> ~~C~~`,
        ].join('\n'),
      },
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['a']))
    const updateCall = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 7)
    expect(updateCall[0].body).toContain(`- [x] <!-- repomanager:${encodeId('a')} --> ~~A~~`)
    expect(updateCall[0].body).toContain(`- [ ] <!-- repomanager:${encodeId('b')} --> B`)
    expect(updateCall[0].body).toContain(`- [x] <!-- repomanager:${encodeId('c')} --> ~~C~~`)
  })
})

describe('markItemsApplied concurrent writers', () => {
  // Simulates two webhook invocations interleaving GET/PUT against a single
  // shared issue body. Both writers must converge to a final body where
  // their appliedIds are all struck through.
  it('converges on overlapping strike-through when two writers race', async () => {
    let body = [
      `- [x] <!-- repomanager:${encodeId('a')} --> A`,
      `- [x] <!-- repomanager:${encodeId('b')} --> B`,
    ].join('\n')
    const make = () => {
      const oct = createMockOctokit()
      oct.rest.issues.get = jest.fn(async () => ({ data: { number: 1, body } }))
      oct.rest.issues.update = jest.fn(async ({ body: newBody }) => {
        body = newBody
        return { data: {} }
      })
      return oct
    }
    const o1 = make()
    const o2 = make()
    // Order chosen to expose the read-modify-write race: both writers
    // GET, both compute, w1 PUTs, then w2 PUTs (w2 would otherwise
    // overwrite w1).
    const w1 = markItemsApplied(o1, makeRepo(), 1, new Set(['a']))
    const w2 = markItemsApplied(o2, makeRepo(), 1, new Set(['b']))
    await Promise.all([w1, w2])
    expect(body).toContain(`- [x] <!-- repomanager:${encodeId('a')} --> ~~A~~`)
    expect(body).toContain(`- [x] <!-- repomanager:${encodeId('b')} --> ~~B~~`)
  })

  it('is a no-op when its target items are already struck', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 1,
        body: `- [x] <!-- repomanager:${encodeId('a')} --> ~~A~~`,
      },
    })
    await markItemsApplied(octokit, makeRepo(), 1, new Set(['a']))
    expect(octokit.rest.issues.update).not.toHaveBeenCalled()
  })
})

describe('markItemsApplied failure marker', () => {
  it('unticks the box and prefixes ⚠️ when an item fails to apply', async () => {
    let body = `- [x] <!-- repomanager:${encodeId('a')} --> A`
    const octokit = createMockOctokit()
    octokit.rest.issues.get = jest.fn(async () => ({
      data: { number: 7, state: 'open', body },
    }))
    octokit.rest.issues.update = jest.fn(async (args) => {
      if (args.body) body = args.body
      return { data: {} }
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(), new Set(['a']))
    expect(body).toContain(`- [ ] <!-- repomanager:${encodeId('a')} --> ⚠️ A`)
  })

  it('clears ⚠️ and adds strike-through when a failed item is later applied', async () => {
    let body = `- [ ] <!-- repomanager:${encodeId('a')} --> ⚠️ A`
    const octokit = createMockOctokit()
    octokit.rest.issues.get = jest.fn(async () => ({
      data: { number: 7, state: 'open', body },
    }))
    octokit.rest.issues.update = jest.fn(async (args) => {
      if (args.body) body = args.body
      return { data: {} }
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['a']), new Set())
    expect(body).toContain(`- [x] <!-- repomanager:${encodeId('a')} --> ~~A~~`)
    expect(body).not.toContain('⚠️')
  })
})

// Build PAT/bearer-shaped fixtures at runtime so the literal token shape
// doesn't appear in source — keeps secret-scanners happy while still
// triggering the redaction regex when the test runs.
const fakePat = ['gh', 'p', '_', 'a'.repeat(36)].join('')
const fakeBearerToken = ['x'.repeat(20), '.', 'y'.repeat(20), '.', 'z'.repeat(8)].join('')

describe('sanitizeErrorMessage', () => {
  it('redacts GitHub PAT-shaped tokens', () => {
    const out = sanitizeErrorMessage(`failed: ${fakePat}`)
    expect(out).not.toContain(fakePat)
    expect(out).toContain('[REDACTED]')
  })

  it('redacts bearer auth headers', () => {
    expect(sanitizeErrorMessage(`Authorization: Bearer ${fakeBearerToken}`)).toMatch(
      /\[REDACTED\]/,
    )
  })

  it('redacts PEM private keys', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    const out = sanitizeErrorMessage(`crash: ${pem} done`)
    expect(out).not.toContain('MIIEowIBAAKCAQEA')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts named secret/token/key=value pairs', () => {
    const out = sanitizeErrorMessage('boom token=abcdefgh1234567890 secret: hunter2hunter2')
    expect(out).not.toMatch(/abcdefgh1234567890/)
    expect(out).not.toMatch(/hunter2hunter2/)
  })

  it('truncates very long messages', () => {
    const big = 'x'.repeat(10000)
    const out = sanitizeErrorMessage(big)
    expect(out.length).toBeLessThan(5000)
    expect(out).toMatch(/truncated/)
  })

  it('passes safe text through unchanged', () => {
    const out = sanitizeErrorMessage('Invalid property /rules/3: data matches no possible input.')
    expect(out).toBe('Invalid property /rules/3: data matches no possible input.')
  })
})

describe('postFailureComment', () => {
  it('creates a single comment summarising every failed item with sanitised errors', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.createComment = jest.fn(async () => ({ data: {} }))
    await postFailureComment(octokit, makeRepo(), 7, [
      {
        id: 'ruleset:create:r',
        summary: 'Create ruleset r',
        error: { message: 'Invalid property /rules/3: data matches no possible input' },
      },
      {
        id: 'files:pr',
        summary: 'Open PR',
        error: { message: `leaked ${fakePat} here` },
      },
    ])
    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1)
    const body = octokit.rest.issues.createComment.mock.calls[0][0].body
    expect(body).toContain('`ruleset:create:r`')
    expect(body).toContain('`files:pr`')
    expect(body).toContain('Invalid property /rules/3')
    expect(body).not.toContain(fakePat)
    expect(body).toContain('[REDACTED]')
  })

  it('does nothing when there are no failures', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.createComment = jest.fn(async () => ({ data: {} }))
    await postFailureComment(octokit, makeRepo(), 7, [])
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })
})

describe('markItemsApplied auto-close', () => {
  it('closes the issue once every item is applied', async () => {
    let body = [
      `- [x] <!-- repomanager:${encodeId('a')} --> ~~A~~`,
      `- [x] <!-- repomanager:${encodeId('b')} --> B`,
    ].join('\n')
    const octokit = createMockOctokit()
    octokit.rest.issues.get = jest.fn(async () => ({
      data: { number: 7, state: 'open', body },
    }))
    octokit.rest.issues.update = jest.fn(async (args) => {
      if (args.body) body = args.body
      return { data: {} }
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['b']))
    const closeCall = octokit.rest.issues.update.mock.calls.find(
      (c) => c[0].state === 'closed',
    )
    expect(closeCall).toBeTruthy()
    expect(closeCall[0].state_reason).toBe('completed')
  })

  it('does not close when items still remain unapplied', async () => {
    let body = [
      `- [ ] <!-- repomanager:${encodeId('a')} --> A`,
      `- [x] <!-- repomanager:${encodeId('b')} --> B`,
    ].join('\n')
    const octokit = createMockOctokit()
    octokit.rest.issues.get = jest.fn(async () => ({
      data: { number: 7, state: 'open', body },
    }))
    octokit.rest.issues.update = jest.fn(async (args) => {
      if (args.body) body = args.body
      return { data: {} }
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['b']))
    const closeCall = octokit.rest.issues.update.mock.calls.find(
      (c) => c[0].state === 'closed',
    )
    expect(closeCall).toBeFalsy()
  })
})

describe('upsertConsentIssue close + reopen', () => {
  it('closes an open issue when every change is already applied', async () => {
    const octokit = createMockOctokit()
    const existingBody = [
      `- [x] <!-- repomanager:${encodeId('files:pr')} --> ~~Open templated PR~~`,
      `- [x] <!-- repomanager:${encodeId('bp:main')} --> ~~Apply BP~~`,
    ].join('\n')
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 9, title: ISSUE_TITLE, state: 'open', body: existingBody }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'files:pr', kind: 'files', summary: 'Open templated PR' },
      { id: 'bp:main', kind: 'branchProtection', summary: 'Apply BP' },
    ])
    const call = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 9)
    expect(call[0].state).toBe('closed')
    expect(call[0].state_reason).toBe('completed')
  })

  it('reopens a closed issue when drift introduces an unapplied change', async () => {
    const octokit = createMockOctokit()
    const existingBody = [
      `- [x] <!-- repomanager:${encodeId('files:pr')} --> ~~Open templated PR~~`,
    ].join('\n')
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 9, title: ISSUE_TITLE, state: 'closed', body: existingBody }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'files:pr', kind: 'files', summary: 'Open templated PR' },
      { id: 'bp:main', kind: 'branchProtection', summary: 'Apply BP' },
    ])
    const call = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 9)
    expect(call[0].state).toBe('open')
    expect(call[0].state_reason).toBe('reopened')
  })

  it('leaves a closed issue closed when all current changes are already applied', async () => {
    const octokit = createMockOctokit()
    const existingBody = [
      `- [x] <!-- repomanager:${encodeId('files:pr')} --> ~~Open templated PR~~`,
    ].join('\n')
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 9, title: ISSUE_TITLE, state: 'closed', body: existingBody }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'files:pr', kind: 'files', summary: 'Open templated PR' },
    ])
    expect(
      octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 9),
    ).toBeFalsy()
  })
})

describe('upsertConsentIssue state preservation', () => {
  it('preserves user ticks and applied strike-through when re-rendering', async () => {
    const octokit = createMockOctokit()
    const existingBody = [
      `- [x] <!-- repomanager:${encodeId('files:pr')} --> ~~Open PR to update templated files~~`,
      `- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply BP`,
      `- [ ] <!-- repomanager:${encodeId('repo:update')} --> Update repo settings`,
    ].join('\n')
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 9, title: ISSUE_TITLE, body: existingBody }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [
      { id: 'files:pr', kind: 'files', summary: 'Open PR to update templated files' },
      { id: 'bp:main', kind: 'branchProtection', summary: 'Apply BP' },
      { id: 'repo:update', kind: 'repo', summary: 'Update repo settings' },
    ])
    const updateCall = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 9)
    expect(updateCall[0].body).toContain(
      `- [x] <!-- repomanager:${encodeId('files:pr')} --> ~~Open PR to update templated files~~`,
    )
    expect(updateCall[0].body).toContain(`- [x] <!-- repomanager:${encodeId('bp:main')} --> Apply BP`)
    expect(updateCall[0].body).toContain(
      `- [ ] <!-- repomanager:${encodeId('repo:update')} --> Update repo settings`,
    )
  })
})

describe('invalid config issues', () => {
  it('opens an invalid-config issue with error lines', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    octokit.rest.issues.getLabel.mockRejectedValue(notFoundError())
    await openInvalidConfigIssue(octokit, makeRepo(), ['- [ ] `foo`: expected boolean'])
    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: INVALID_TITLE, body: expect.stringContaining('foo') }),
    )
  })

  it('closes existing invalid-config issue when config is now valid', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [{ number: 11, title: INVALID_TITLE, state: 'open' }],
    })
    await closeInvalidConfigIssue(octokit, makeRepo())
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 11, state: 'closed' }),
    )
  })
})
