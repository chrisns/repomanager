const decodeCert = (raw) => {
  if (raw.startsWith('-----')) return raw
  return Buffer.from(raw, 'base64').toString()
}

// The `octokit` meta-package wires in @octokit/plugin-throttling with default
// handlers that, on a primary or secondary rate limit, sleep for the
// Retry-After / reset window and then retry. That sleep is real wall-clock —
// inside a Lambda we are billed GB-seconds the whole time it dozes, and a
// secondary-limit hit with no Retry-After header sleeps a hard-coded 60s. For a
// cron worker that re-runs on the next tick anyway, sleeping-to-retry is pure
// waste. Bound it: never sleep on secondary/abuse limits, and only ride out a
// primary limit once if the wait is trivially short. Anything longer throws,
// the per-repo loop records it as a skip, and the next tick picks it up.
const throttle = {
  onRateLimit: (retryAfter, _options, _octokit, retryCount) => retryCount === 0 && retryAfter <= 5,
  onSecondaryRateLimit: () => false,
}

const createApp = async () => {
  if (!process.env.APP_ID || !process.env.CERT) {
    throw new Error('APP_ID and CERT environment variables are required')
  }
  const { App, Octokit } = await import('octokit')
  const { createPullRequest } = await import('octokit-plugin-create-pull-request')
  const MyOctokit = Octokit.plugin(createPullRequest).defaults({ throttle })
  return new App({
    appId: process.env.APP_ID,
    privateKey: decodeCert(process.env.CERT),
    webhooks: {
      secret: process.env.GITHUB_WEBHOOK_SECRET || 'development',
    },
    Octokit: MyOctokit,
  })
}

module.exports = { createApp }
