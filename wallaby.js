module.exports = function () {
  return {
    files: ['*.js'],

    tests: ['test/**/*.js'],

    testFramework: 'mocha',

    env: {
      type: 'node'
    },

    workers: { recycle: true }
  }
}
