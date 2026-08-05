module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  moduleNameMapper: {
    '^../db/pool$': '<rootDir>/tests/__mocks__/pool.js',
  },
};
