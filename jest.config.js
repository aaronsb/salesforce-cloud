// @ts-check

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@modelcontextprotocol/sdk/(.*)$': '<rootDir>/node_modules/@modelcontextprotocol/sdk/dist/cjs/$1'
  },
  transform: {
    '^.+\\.(ts|js)x?$': [
      'ts-jest',
      {
        useESM: false
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol/sdk)/)'
  ],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.[jt]s?(x)',
    '<rootDir>/src/**/?(*.)+(spec|test).[jt]s?(x)'
  ]
};
