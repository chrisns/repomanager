const chai = require('chai')
const sinon = require('sinon')
const rewire = require('rewire')
chai.use(require('chai-as-promised'))
chai.use(require('sinon-chai'))
chai.should()

describe('#handler', () => {
  let mod
  beforeEach(() => {
    mod = rewire('../handler')
  })
  describe('#getRepoConfig()', () => {
    let revert
    beforeEach(() => {
      revert = mod.__set__({
        fs: {
          readFileSync: () => {
            return { toString: () => 'bar: foo' }
          }
        }
      })
    })
    afterEach(() => revert())
    it('should work with just a base config if the repo+owner don`t have config', () => {
      return mod
        .__get__('getRepoConfig')('foo', 'bar', {})
        .should.eventually.eql({ bar: 'foo' })
    })
    it('should override the base config with the owner then the repo', () => {
      const configFromRepo = 'bar: another'
      const configFromOwner = 'another: bar'
      const octomock = {
        repos: {
          getContent: sinon.stub()
        }
      }
      octomock.repos.getContent.onCall(0).resolves({
        data: { content: Buffer.from(configFromRepo).toString('base64') }
      })
      octomock.repos.getContent.onCall(1).resolves({
        data: { content: Buffer.from(configFromOwner).toString('base64') }
      })
      return mod
        .__get__('getRepoConfig')('foo', 'bar', octomock)
        .should.eventually.eql({ bar: 'another', another: 'bar' })
    })
  })
})
