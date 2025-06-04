const YAML = require('yaml')
const fs = require('fs')

const { Octokit } = require('@octokit/rest')
const { createPullRequest } = require('octokit-plugin-create-pull-request')
const { paginateRest } = require('@octokit/plugin-paginate-rest')

const MyOctokit = Octokit.plugin(createPullRequest).plugin(paginateRest)

const newOctokit = (installationId) => {
  const auth = {
    appId: process.env.APP_ID,
    privateKey: process.env.CERT
  }
  if (installationId) auth.installationId = installationId
  return new MyOctokit({
    authStrategy: require('@octokit/auth-app').createAppAuth,
    auth
  })
}

const cron = async () => {
  const octokit = newOctokit(0)
  const installations = await octokit.paginate(octokit.apps.listInstallations)

  const repos = await Promise.allSettled(
    installations.map(async (inst) => {
      const octokit = newOctokit(inst.id)
      return octokit
        .paginate(octokit.apps.listReposAccessibleToInstallation, inst.id)
        .then((repos) =>
          repos.filter(
            (repo) =>
              repo.fork === false &&
              repo.disabled === false &&
              repo.archived === false
          )
        )
        .then(async (repos) =>
          Promise.allSettled(
            repos.map(async (repo) => {
              return {
                ...repo,
                installationId: inst.id,
                octokit,
                desiredConfig: await getRepoConfig(
                  repo.name,
                  repo.owner.login,
                  octokit
                )
              }
            })
          )
        )
    })
  )
  const newrepos = []
  repos.forEach((install) => {
    if (install.status === 'fulfilled')
      install.value.forEach((repo) => {
        if (repo.status === 'fulfilled') newrepos.push(repo.value)
      })
  })
  await Promise.allSettled(newrepos.map(applyConfig))
}

const applyConfig = async (repo) => {
  const octokit = repo.octokit
  console.info(`applying config to ${repo.owner.login}/${repo.name}`)

  if (repo.desiredConfig.vulnerabilityAlerts === true) {
    await octokit.repos.enableVulnerabilityAlerts({
      owner: repo.owner.login,
      repo: repo.name
    })
  } else if (repo.desiredConfig.vulnerabilityAlerts === false) {
    octokit.repos.disableVulnerabilityAlerts({
      owner: repo.owner.login,
      repo: repo.name
    })
  }

  if (repo.desiredConfig.automatedSecurityFixes === true) {
    await octokit.repos.enableAutomatedSecurityFixes({
      owner: repo.owner.login,
      repo: repo.name
    })
  } else if (repo.desiredConfig.automatedSecurityFixes === false) {
    octokit.repos.disableAutomatedSecurityFixes({
      owner: repo.owner.login,
      repo: repo.name
    })
  }

  if (
    repo.desiredConfig.branchProtection &&
    repo.private === false &&
    repo.default_branch
  ) {
    const branchProtectionConfig = await Promise.allSettled(
      repo.desiredConfig.branchProtection.map(async (a) => {
        return {
          owner: repo.owner.login,
          repo: repo.name,
          ...a,
          branch:
            a.branch === '__DEFAULT_BRANCH__' ? repo.default_branch : a.branch,
          required_status_checks:
            a.required_status_checks.contexts === 'ALL'
              ? await (async () => {
                  try {
                    a.required_status_checks.contexts = Array.from(
                      new Set(
                        (
                          await octokit.checks.listForRef({
                            owner: repo.owner.login,
                            repo: repo.name,
                            ref: `refs/heads/${
                              a.branch === '__DEFAULT_BRANCH__'
                                ? repo.default_branch
                                : a.branch
                            }`
                          })
                        ).data.check_runs.map((check) => check.name)
                      )
                    )
                  } catch (error) {
                    a.required_status_checks.contexts = []
                  }
                  return a.required_status_checks
                })(a.required_status_checks)
              : a.required_status_checks
        }
      })
    )
    console.log(branchProtectionConfig[0])
    await Promise.allSettled(
      branchProtectionConfig.map(octokit.repos.updateBranchProtection)
    )
  }
  if (repo.desiredConfig.repo) {
    await octokit.repos.update({
      owner: repo.owner.login,
      repo: repo.name,
      ...repo.desiredConfig.repo
    })
  }

  if (repo.desiredConfig.files !== false) {
    try {
      await octokit.createPullRequest({
        owner: repo.owner.login,
        repo: repo.name,
        title: 'Update templated files',
        body: '',
        createWhenEmpty: false,
        head: 'repomanager_files',
        changes: [
          {
            files: repo.desiredConfig.files,
            emptyCommit: false,
            commit: 'Update templated files'
          }
        ]
      })
    } catch (error) {
      console.error(
        `${repo.full_name}: could not template file PR`,
        error.message
      )
    }
  }
}

const getRepoConfig = async (repo, owner, octokit) => {
  let configFromRepo = {}
  let configFromOwner = {}

  try {
    configFromRepo = YAML.parse(
      Buffer.from(
        (
          await octokit.repos.getContent({
            owner,
            repo,
            path: '.github/repo-config.yml'
          })
        ).data.content,
        'base64'
      ).toString()
    )
  } catch (error) {
    console.info(`${owner}/${repo}: could not get .github/repo-config.yml`)
  }

  try {
    configFromOwner = YAML.parse(
      Buffer.from(
        (
          await octokit.repos.getContent({
            owner,
            repo: '.github',
            path: 'repo-config.yml'
          })
        ).data.content,
        'base64'
      ).toString()
    )
  } catch (error) {
    console.warn(`${owner}/.github: could not get .github/repo-config.yml`)
  }

  const baseConfig = YAML.parse(
    fs.readFileSync('./base-repo-config.yml').toString()
  )
  return { ...baseConfig, ...configFromOwner, ...configFromRepo }
}

module.exports = {
  cron,
  getRepoConfig,
  applyConfig,
  newOctokit,
  MyOctokit
}
