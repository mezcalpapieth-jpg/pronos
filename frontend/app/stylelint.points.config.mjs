export default {
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'font-size', 'border-radius'],
      {
        ignoreFunctions: false,
        ignoreValues: ['0', 'auto', 'currentColor', 'inherit', 'initial', 'none', 'revert', 'transparent', 'unset'],
      },
    ],
  },
};
