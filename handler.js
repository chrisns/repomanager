const YAML = require('yaml')
const fs = require('fs')

const { Octokit } = require('@octokit/rest')
const { createPullRequest } = require('octokit-plugin-create-pull-request')
const { paginateRest } = require('@octokit/plugin-paginate-rest')

const MyOctokit = Octokit.plugin(createPullRequest).plugin(paginateRest)

const newOctokit = installationId =>
  new MyOctokit({
    authStrategy: require('@octokit/auth-app').createAppAuth,
    auth: {
      appId: 89571,
      privateKey: fs.readFileSync(
        'the-repository-manager.2020-11-20.private-key.pem'
      ),
      installationId
    }
  })

const cron = async () => {
  const octokit = newOctokit()
  const installations = await octokit.paginate(octokit.apps.listInstallations)

  const repos = await Promise.all(
    installations.map(async inst => {
      const octokit = newOctokit(inst.id)
      return octokit
        .paginate(octokit.apps.listReposAccessibleToInstallation, inst.id)
        .then(repos =>
          repos.filter(
            repo =>
              repo.fork === false &&
              repo.disabled === false &&
              repo.archived === false
          )
        )
        .then(async repos =>
          Promise.all(
            repos.map(async repo => {
              return {
                ...repo,
                installationId: inst.id,
                octokit: octokit,
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

  await Promise.all(repos.flat().map(applyConfig))
}

const applyConfig = async repo => {
  const octokit = repo.octokit
  console.log(repo.desiredConfig.repo)
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

  if (repo.desiredConfig.branchProtection) {
    const branchProtectionConfig = repo.desiredConfig.branchProtection.map(
      a => {
        return {
          owner: repo.owner.login,
          repo: repo.name,
          ...a,
          branch:
            a.branch === '__DEFALT_BRANCH__' ? repo.default_branch : a.branch
        }
      }
    )
    await Promise.all(
      branchProtectionConfig.map(octokit.repos.updateBranchProtection)
    )
  }
  if (repo.desiredConfig.license) {
    let currentLicense = false
    try {
      currentLicense = (
        await octokit.licenses.getForRepo({
          owner: repo.owner.login,
          repo: repo.name
        })
      ).data
    } catch (error) {
      console.log(`${repo.full_name}: Could not get current licence`)
    }
    try {
      await octokit.createPullRequest({
        owner: repo.owner.login,
        repo: repo.name,
        title: `${currentLicense ? 'Update' : 'Create'} License`,
        body: '',
        createWhenEmpty: false,
        head: 'repomanager_license',
        changes: [
          {
            files: {
              [currentLicense ? currentLicense.path : 'LICENSE']: repo
                .desiredConfig.license
            },
            emptyCommit: false,
            commit: 'LICENSE'
          }
        ]
      })
    } catch (error) {
      console.log(`${repo.full_name}: could not create license PR`)
    }
  }
  if (repo.desiredConfig.repo) {
    await octokit.repos.update({
      owner: repo.owner.login,
      repo: repo.name,
      ...repo.desiredConfig.repo
    })
  }

  if (repo.desiredConfig.dependabot !== false) {
    let dependabotConfig = {
      version: 2,
      updates: []
    }
    if (repo.desiredConfig.dependabot === 'auto') {
      try {
        await octokit.repos.getContent({
          owner: repo.owner.login,
          repo: repo.name,
          path: 'package.json'
        })
        dependabotConfig.updates.push({ 'package-ecosystem': 'npm' })
      } catch (error) {
        console.log(`${repo.full_name}: Dependabot no package.json`)
      }
      try {
        await octokit.repos.getContent({
          owner: repo.owner.login,
          repo: repo.name,
          path: 'Dockerfile'
        })
        dependabotConfig.updates.push({ 'package-ecosystem': 'docker' })
      } catch (error) {
        console.log(`${repo.full_name}: Dependabot no Dockerfile`)
      }

      dependabotConfig.updates.push({ 'package-ecosystem': 'github-actions' })

      dependabotConfig.updates = dependabotConfig.updates.map(a => {
        return { ...a, directory: '/', schedule: { interval: 'daily' } }
      })
    } else {
      dependabotConfig = repo.desiredConfig.dependabot
    }
    try {
      await octokit.createPullRequest({
        owner: repo.owner.login,
        repo: repo.name,
        title: 'Update dependabot config',
        body: '',
        createWhenEmpty: false,
        head: 'repomanager_dependabot',
        changes: [
          {
            files: {
              '.github/dependabot.yml': YAML.stringify(dependabotConfig)
            },
            emptyCommit: false,
            commit: 'Dependabot config'
          }
        ]
      })
    } catch (error) {
      console.log(`${repo.full_name}: could not create dependabot PR`)
    }
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
      console.log(`${repo.full_name}: could not template file PR`)
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
    console.log(`${owner}/${repo}: could not get .github/repo-config.yml`)
  }

  try {
    configFromOwner = YAML.parse(
      Buffer.from(
        (
          await octokit.repos.getContent({
            owner,
            repo: 'repo-config',
            path: 'repo-config.yml'
          })
        ).data.content,
        'base64'
      ).toString()
    )
  } catch (error) {
    console.log(`${owner}/repo-config: could not get .github/repo-config.yml`)
  }

  const baseConfig = YAML.parse(
    fs.readFileSync('./base-repo-config.yml').toString()
  )
  return { ...baseConfig, ...configFromOwner, ...configFromRepo }
}

module.exports = {
  cron
}
