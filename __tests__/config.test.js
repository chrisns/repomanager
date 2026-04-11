const { getRepoConfig } = require('../src/config')
const { RepoConfig } = require('../src/config-schema')
const { createMockOctokit, notFoundError } = require('./helpers')

const base64 = (str) => Buffer.from(str).toString('base64')

describe('getRepoConfig', () => {
  it('returns base config when owner and repo config are missing', async () => {
    const octokit = createMockOctokit()
    octokit.rest.repos.getContent.mockRejectedValue(notFoundError())

    const { config, errors } = await getRepoConfig('r', 'o', octokit)
    expect(errors).toBeNull()
    expect(config.vulnerabilityAlerts).toBe(true)
    expect(config.secretScanning).toBe(true)
  })

  it('merges base, owner, and repo configs deeply (preserves nested keys)', async () => {
    const octokit = createMockOctokit()
    const ownerYaml = 'repo:\n  has_issues: false\n  has_wiki: true\n'
    const repoYaml = 'repo:\n  has_wiki: false\n  delete_branch_on_merge: true\n'
    octokit.rest.repos.getContent
      .mockResolvedValueOnce({ data: { content: base64(ownerYaml) } })
      .mockResolvedValueOnce({ data: { content: base64(repoYaml) } })

    const { config, errors } = await getRepoConfig('r', 'o', octokit)
    expect(errors).toBeNull()
    expect(config.repo).toEqual({
      has_issues: false,
      has_wiki: false,
      delete_branch_on_merge: true,
    })
  })

  it('returns structured errors when the merged config is invalid', async () => {
    const octokit = createMockOctokit()
    const invalid = 'vulnerabilityAlerts: "nope"\n'
    octokit.rest.repos.getContent
      .mockRejectedValueOnce(notFoundError())
      .mockResolvedValueOnce({ data: { content: base64(invalid) } })

    const { config, errors } = await getRepoConfig('r', 'o', octokit)
    expect(config).toBeNull()
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/vulnerabilityAlerts/)]))
  })
})

describe('RepoConfig schema', () => {
  it('accepts branchProtection with ALL contexts', () => {
    const result = RepoConfig.safeParse({
      branchProtection: [
        {
          branch: '__DEFAULT_BRANCH__',
          required_status_checks: { strict: true, contexts: 'ALL' },
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown top-level keys', () => {
    const result = RepoConfig.safeParse({ totallyUnknown: true })
    expect(result.success).toBe(false)
  })
})
