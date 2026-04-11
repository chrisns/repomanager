module.exports = {
  coverageReporters: ['lcovonly', 'text'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['handler.js', 'src/**/*.js', '!src/octokit.js'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers.js'],
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 75,
      lines: 75,
    },
  },
}
