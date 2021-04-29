module.exports = {
  coverageReporters: ['lcovonly', 'text'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!.**',
    '!tests/**',
    '!node_modules/**',
    '!coverage/**',
    '!jest.config.js',
    '!wallaby.js',
  ],
}
