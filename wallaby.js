module.exports = function () {
  return {
    files: ['*.js'],

    tests: ['test/**/*.js'],

    testFramework: 'jest',

    env: {
      type: 'node'
    },

    workers: { recycle: true }
  }
}
