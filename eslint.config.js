import teamConfig from "@lonely9/eslint-config-team";

export default [
  ...teamConfig.recommended,
  {
    languageOptions: {
      globals: {},
    },
  },

  {
    // 自定义规则
    rules: {},
  },

  teamConfig.skipFormatting,
];
