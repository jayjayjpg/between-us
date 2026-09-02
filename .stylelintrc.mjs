export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Tailwind v4 at-rules (@theme, @apply, @layer, ...) and their preludes
    // aren't known to stylelint-config-standard.
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'apply',
          'layer',
          'variant',
          'custom-variant',
          'utility',
          'reference',
          'config',
        ],
      },
    ],
    'at-rule-prelude-no-invalid': null,
    // `@import "tailwindcss";` is valid CSS import syntax, just not url().
    'import-notation': 'string',
  },
};
