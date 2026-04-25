const {
  renderPlan,
  parseCheckedItems,
  parseAllItems,
  upsertConsentIssue,
  markItemsApplied,
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
    ].join('\n')
    const items = parseAllItems(body)
    expect(items).toEqual([
      { id: 'a', checked: false, applied: false, summary: 'A' },
      { id: 'bp:main', checked: true, applied: false, summary: 'B' },
      { id: 'done', checked: true, applied: true, summary: 'Done thing' },
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

  it('does not create a new issue when there are no changes', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] })
    const result = await upsertConsentIssue(octokit, makeRepo(), [])
    expect(result).toBeNull()
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
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
      data: [{ number: 11, title: INVALID_TITLE }],
    })
    await closeInvalidConfigIssue(octokit, makeRepo())
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 11, state: 'closed' }),
    )
  })
})
