/** @type {import('tailwindcss').Config} */
const { nirDesignSystemConfig } = require('./src/design-system/theme/tailwind.config');

module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      ...nirDesignSystemConfig.theme.extend,
      fontFamily: {
        ...nirDesignSystemConfig.theme.extend.fontFamily,
        vazir: ['Vazirmatn_400Regular'],
        'vazir-medium': ['Vazirmatn_500Medium'],
        'vazir-bold': ['Vazirmatn_700Bold'],
      },
      colors: {
        ...nirDesignSystemConfig.theme.extend.colors,
        // Keep legacy primary for backward compatibility during migration
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },
    },
  },
  plugins: [],
};