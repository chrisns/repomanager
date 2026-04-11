const YAML = require('yaml')
const fs = require('fs')
const path = require('path')
const deepmerge = require('deepmerge')
const { RepoConfig, formatIssues } = require('./config-schema')

const BASE_CONFIG_PATH = path.join(__dirname, '..', 'base-repo-config.yml')

const loadBaseConfig = () => YAML.parse(fs.readFileSync(BASE_CONFIG_PATH).toString()) || {}

const fetchYaml = async (octokit, owner, repo, filePath) => {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath })
    const content = Buffer.from(data.content, 'base64').toString()
    return YAML.parse(content) || {}
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

const getRepoConfig = async (repo, owner, octokit) => {
  const baseConfig = loadBaseConfig()

  let ownerConfig = null
  try {
    ownerConfig = await fetchYaml(octokit, owner, '.github', 'repo-config.yml')
  } catch (error) {
    console.warn(`${owner}/.github: could not read repo-config.yml: ${error.message}`)
  }

  let repoConfig = null
  try {
    repoConfig = await fetchYaml(octokit, owner, repo, '.github/repo-config.yml')
  } catch (error) {
    console.warn(`${owner}/${repo}: could not read .github/repo-config.yml: ${error.message}`)
  }

  const merged = deepmerge.all([baseConfig, ownerConfig || {}, repoConfig || {}], {
    arrayMerge: (_destination, source) => source,
  })

  const parsed = RepoConfig.safeParse(merged)
  if (!parsed.success) {
    const errorLines = formatIssues(parsed.error)
    return {
      config: null,
      errors: errorLines,
      raw: merged,
    }
  }

  return { config: parsed.data, errors: null, raw: merged }
}

module.exports = {
  loadBaseConfig,
  fetchYaml,
  getRepoConfig,
}
