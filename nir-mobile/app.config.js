// Dynamic Expo config.
//
// Why this file exists: the dev APK must be installable **next to** the production app, never
// replacing it (docs/PROMPT-ANDROID-DEV-ONLY.md §1-1/§5-9 requires a separate applicationId),
// and it must default to the dev domain only.
//
//   APP_VARIANT=dev        -> name "NIR Dev", package ir.artadan.nir.dev, default API https://dev.artadan.ir
//   APP_VARIANT unset/prod -> name "NIR",     package ir.artadan.nir,     default API https://app.artadan.ir
//
// The variant is supplied per EAS profile in eas.json (`build.<profile>.env.APP_VARIANT`).
// app.json stays the single source of static settings (icons, plugins, permissions, EAS project id).
const appJson = require('./app.json');

const variant = String(process.env.APP_VARIANT || 'production').toLowerCase();
const isDev = variant === 'dev';

// The dev APK lives in its own versionCode lane (+1000) so it can be installed/upgraded over a
// previous dev build while the production versionCode sequence (4, 5, 6 …) stays untouched.
// docs/PROMPT-ANDROID-DEV-ONLY.md requires an independent, rising versionCode for the dev app.
const baseVersionCode = Number(appJson.expo.android.versionCode || 1);

const expo = {
  ...appJson.expo,
  name: isDev ? 'NIR Dev' : appJson.expo.name,
  android: {
    ...appJson.expo.android,
    package: isDev ? 'ir.artadan.nir.dev' : appJson.expo.android.package,
    versionCode: isDev ? baseVersionCode + 1000 : baseVersionCode,
  },
  ios: {
    ...appJson.expo.ios,
    bundleIdentifier: isDev ? 'ir.artadan.nir.dev' : appJson.expo.ios.bundleIdentifier,
  },
  extra: {
    ...appJson.expo.extra,
    // visible in-app so an installed dev build can never be mistaken for the production app
    appVariant: isDev ? 'dev' : 'production',
    apiBaseUrl: isDev ? 'https://dev.artadan.ir' : 'https://app.artadan.ir',
  },
};

module.exports = { expo };
