const createApp = async () => {
  if (!process.env.APP_ID || !process.env.CERT) {
    throw new Error('APP_ID and CERT environment variables are required')
  }
  const { App, Octokit } = await import('octokit')
  const { createPullRequest } = await import('octokit-plugin-create-pull-request')
  const MyOctokit = Octokit.plugin(createPullRequest)
  return new App({
    appId: process.env.APP_ID,
    privateKey: process.env.CERT,
    webhooks: {
      secret: process.env.GITHUB_WEBHOOK_SECRET || 'development',
    },
    Octokit: MyOctokit,
  })
}

module.exports = { createApp }
