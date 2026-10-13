/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@vault/shared$': '<rootDir>/../shared/src/index.ts',
  },
};
