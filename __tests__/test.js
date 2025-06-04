jest.mock('fs')
const fs = require('fs')
fs.readFileSync = () => {
  return { toString: () => 'bar: foo' }
}
const mod = require('../handler')

describe('#getRepoConfig()', () => {
  it('should work with just a base config if the repo+owner don`t have config', () =>
    expect(mod.getRepoConfig('foo', 'bar', {})).resolves.toMatchSnapshot())
  it('should override the base config with the owner then the repo', () => {
    const configFromRepo = 'bar: another'
    const configFromOwner = 'another: bar'
    const octomock = {
      repos: {
        getContent: jest
          .fn()
          .mockResolvedValueOnce({
            data: { content: Buffer.from(configFromRepo).toString('base64') }
          })
          .mockResolvedValueOnce({
            data: { content: Buffer.from(configFromOwner).toString('base64') }
          })
      }
    }
    return expect(
      mod.getRepoConfig('foo', 'bar', octomock)
    ).resolves.toMatchSnapshot()
  })
})

describe('#cron()', () => {
  it('should only process fulfilled repo results', () => {
    const repos = [
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: 'fail' }
    ]
    const installations = [{ status: 'fulfilled', value: repos }]

    const newrepos = []
    installations.forEach((install) => {
      if (install.status === 'fulfilled')
        install.value.forEach((repo) => {
          if (repo.status === 'fulfilled') newrepos.push(repo.value)
        })
    })

    expect(newrepos).toEqual(['ok'])
  })
})
