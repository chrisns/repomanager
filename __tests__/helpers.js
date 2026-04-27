const makeRepo = (overrides = {}) => ({
  name: 'test-repo',
  full_name: 'test-owner/test-repo',
  owner: { login: 'test-owner' },
  default_branch: 'main',
  fork: false,
  archived: false,
  disabled: false,
  private: false,
  ...overrides,
})

const createMockOctokit = () => {
  const calls = []
  const record = (method) =>
    jest.fn(async (args = {}) => {
      calls.push({ method, args })
      return { data: {} }
    })
  const mock = {
    paginate: jest.fn(async () => []),
    createPullRequest: jest.fn(async () => ({ data: { number: 1 } })),
    rest: {
      repos: {
        enableVulnerabilityAlerts: record('repos.enableVulnerabilityAlerts'),
        disableVulnerabilityAlerts: record('repos.disableVulnerabilityAlerts'),
        enableAutomatedSecurityFixes: record('repos.enableAutomatedSecurityFixes'),
        disableAutomatedSecurityFixes: record('repos.disableAutomatedSecurityFixes'),
        updateBranchProtection: record('repos.updateBranchProtection'),
        update: record('repos.update'),
        // Default to "drift everywhere": planRepoUpdate / planFiles /
        // planBranchProtection treat fetch failures and missing data as
        // drift, so existing tests that don't care about the diff path keep
        // exercising the change-emitting branch they always have.
        get: jest.fn(async () => {
          const err = new Error('Not Found')
          err.status = 404
          throw err
        }),
        getContent: jest.fn(async () => {
          const err = new Error('Not Found')
          err.status = 404
          throw err
        }),
        getBranchProtection: jest.fn(async () => {
          const err = new Error('Not Found')
          err.status = 404
          throw err
        }),
        getRepoRulesets: record('repos.getRepoRulesets'),
        getRepoRuleset: record('repos.getRepoRuleset'),
        createRepoRuleset: record('repos.createRepoRuleset'),
        updateRepoRuleset: record('repos.updateRepoRuleset'),
      },
      checks: {
        listForRef: jest.fn(async () => ({ data: { check_runs: [] } })),
      },
      pulls: {
        list: jest.fn(async () => ({ data: [] })),
      },
      issues: {
        listForRepo: jest.fn(async () => ({ data: [] })),
        create: jest.fn(async (args) => ({ data: { number: 42, ...args } })),
        update: jest.fn(async (args) => ({ data: { number: args.issue_number, ...args } })),
        get: jest.fn(async () => ({ data: { body: '', number: 42 } })),
        getLabel: jest.fn(async () => ({ data: {} })),
        createLabel: jest.fn(async () => ({ data: {} })),
        createComment: jest.fn(async (args) => ({ data: { id: 1, ...args } })),
      },
      search: {
        issuesAndPullRequests: jest.fn(async () => ({ data: { items: [] } })),
      },
    },
  }
  mock.__calls = calls
  return mock
}

const notFoundError = () => {
  const err = new Error('Not Found')
  err.status = 404
  return err
}

module.exports = { makeRepo, createMockOctokit, notFoundError }
