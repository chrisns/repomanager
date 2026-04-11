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
    ].join('\n')
    const items = parseAllItems(body)
    expect(items).toEqual([
      { id: 'a', checked: false, summary: 'A' },
      { id: 'bp:main', checked: true, summary: 'B' },
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
      data: [{ number: 5, title: ISSUE_TITLE, body: 'old' }],
    })
    await upsertConsentIssue(octokit, makeRepo(), [])
    expect(octokit.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 5, state: 'closed' }),
    )
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
  it('rewrites the body with applied items ticked', async () => {
    const octokit = createMockOctokit()
    octokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 7,
        body: [
          `- [ ] <!-- repomanager:${encodeId('a')} --> A`,
          `- [ ] <!-- repomanager:${encodeId('b')} --> B`,
        ].join('\n'),
      },
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['a']))
    const updateCall = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 7)
    expect(updateCall[0].body).toContain(`- [x] <!-- repomanager:${encodeId('a')} --> A`)
    expect(updateCall[0].body).toContain(`- [ ] <!-- repomanager:${encodeId('b')} --> B`)
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
