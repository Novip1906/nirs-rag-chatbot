module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:5173',
  },
  moduleNameMapper: {
    '\\.(css)$': 'identity-obj-proxy',
    '^~/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
    '^@librechat/client$': '<rootDir>/src/ui',
  },
  resolver: '<rootDir>/jest.resolver.cjs',
  transform: {
    '\\.[jt]sx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@ariakit/react-components|@ariakit/react-utils|@ariakit/react-store|@ariakit/components|@ariakit/store|@ariakit/utils|lowlight|highlight\\.js|fault|react-markdown|unified|bail|trough|devlop|is-.*|parse-entities|stringify-entities|character-.*|trim-lines|style-to-object|inline-style-parser|html-url-attributes|escape-string-regexp|longest-streak|zwitch|ccount|markdown-table|comma-separated-tokens|space-separated-tokens|web-namespaces|property-information|remark-.*|rehype-.*|recma-.*|hast.*|mdast-.*|unist-.*|vfile.*|micromark.*|estree-util-.*|decode-named-character-reference)/)/',
  ],
  setupFiles: ['<rootDir>/test/polyfills.js'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  clearMocks: true,
  restoreMocks: true,
};
