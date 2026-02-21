import tsParser from '@typescript-eslint/parser';

const restrictedImportsRule = [
  'error',
  {
    paths: [
      {
        name: '@/design-system/tokens/colors',
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      },
      {
        name: '../design-system/tokens/colors',
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      }
    ],
    patterns: [
      {
        group: ['**/design-system/tokens/colors'],
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      }
    ]
  }
];

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['dist/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      'no-restricted-imports': restrictedImportsRule
    }
  },
  {
    files: ['src/design-system/theme/**', 'src/design-system/utils/useThemeColors.ts'],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
];
