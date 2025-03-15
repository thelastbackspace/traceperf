module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  env: {
    node: true,
    es6: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': ['error', {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
    }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    'max-len': ['error', {
      code: 100,
      ignoreComments: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
    }],
  },
}; 