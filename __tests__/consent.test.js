const {
  renderPlan,
  parseCheckedItems,
  parseAllItems,
  upsertConsentIssue,
  markItemsApplied,
  openInvalidConfigIssue,
  closeInvalidConfigIssue,
  CONSENT_LABEL,
  ISSUE_TITLE,
  INVALID_TITLE,
} = require('../src/consent')
const { createMockOctokit, makeRepo, notFoundError } = require('./helpers')

describe('renderPlan', () => {
  it('emits a task list item per change with a stable marker', () => {
    const body = renderPlan([
      { id: 'bp:main', kind: 'branchProtection', summary: 'Apply BP to `main`' },
      { id: 'ruleset:create:default', kind: 'ruleset', summary: 'Create ruleset' },
    ])
    expect(body).toContain('- [ ] <!-- repomanager:bp:main --> Apply BP to `main`')
    expect(body).toContain('- [ ] <!-- repomanager:ruleset:create:default --> Create ruleset')
  })

  it('renders empty state when there are no changes', () => {
    expect(renderPlan([])).toMatch(/No pending changes/)
  })
})

describe('parseCheckedItems', () => {
  it('returns only ticked ids', () => {
    const body = [
      '- [ ] <!-- repomanager:a --> A',
      '- [x] <!-- repomanager:b --> B',
      '- [X] <!-- repomanager:c --> C',
    ].join('\n')
    const ids = parseCheckedItems(body)
    expect([...ids].sort()).toEqual(['b', 'c'])
  })
})

describe('parseAllItems', () => {
  it('returns the full set of items', () => {
    const body = ['- [ ] <!-- repomanager:a --> A', '- [x] <!-- repomanager:b --> B'].join('\n')
    const items = parseAllItems(body)
    expect(items).toEqual([
      { id: 'a', checked: false, summary: 'A' },
      { id: 'b', checked: true, summary: 'B' },
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
        body: expect.stringContaining('repomanager:ruleset:create:r'),
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
          '- [ ] <!-- repomanager:a --> A',
          '- [ ] <!-- repomanager:b --> B',
        ].join('\n'),
      },
    })
    await markItemsApplied(octokit, makeRepo(), 7, new Set(['a']))
    const updateCall = octokit.rest.issues.update.mock.calls.find((c) => c[0].issue_number === 7)
    expect(updateCall[0].body).toContain('- [x] <!-- repomanager:a --> A')
    expect(updateCall[0].body).toContain('- [ ] <!-- repomanager:b --> B')
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
