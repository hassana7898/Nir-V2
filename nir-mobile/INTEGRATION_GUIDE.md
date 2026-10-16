# راهنمای ادغام سیستم دیزاین nir-mobile

## ۱. فونت Vazirmatn (فونت فارسی)

اضافه کردن فونت به پروژه React Native:

```js
// react-native.config.js
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./src/assets/fonts/'], // فایل‌های Vazirmatn-FD.ttf و أبناء آن
};
```

فایل‌های فونت مورد نیاز:
- Vazirmatn-FD.ttf (Regular)
- Vazirmatn-Bold-FD.ttf
- Vazirmatn-Medium-FD.ttf
- Vazirmatn-SemiBold-FD.ttf
- Vazirmatn-Light-FD.ttf

بعد از اضافه کردن:
```bash
npx react-native link
# یا برای RN >= 0.69
npx react-native run-android
```

در کد، توکن `fontFamily.vazirmatn` = `'Vazirmatn'` است.

## ۲. RTL (راست‌چین)

در نقطه ورود اپلیکیشن (مثلاً `App.tsx` یا `index.ts`):

```tsx
import { setupRTL } from './src/design-system/theme/rtl';
setupRTL();
```

`I18nManager.forceRTL(true)` را صدا می-Zد و تمام لایه‌-outها راست‌چین می‌شوند.

## ۳. Tailwind Config (NativeWind)

در `tailwind.config.js` پروژه اصلی، پیکربندی سیستم دیزاین را import کنید:

```js
const { nirDesignSystemConfig } = require('./src/design-system/theme/tailwind.config');

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: nirDesignSystemConfig.theme.extend,
  },
  plugins: [],
};
```

یا اگر از `nativewind` با `tailwind.config.js` استفاده می‌کنید، مقادیر `colors` و `fontFamily` را merge کنید.

## ۴. ابزار cn و cva

```tsx
import { cn, cva } from './src/design-system/utils/cva';

// مثال استفاده cn
<View className={cn('p-4', isActive && 'bg-primary')}>...</View>

// مثال cva
const buttonStyles = cva('bg-surface', {
  variants: { intent: { primary: 'bg-primary', danger: 'bg-red-500' } },
});
```

## ۵. کامپوننت‌ها

```tsx
import {
  Card, CardHeader, CardTitle, CardContent, CardFooter,
  Badge, Button, Skeleton, SkeletonText, BottomSheet,
} from './src/design-system';
```

### Card
```tsx
<Card variant="elevated" size="lg" radius="xl">
  <CardHeader>
    <CardTitle>عنوان کارت</CardTitle>
    <CardDescription>توضیح کوتاه</CardDescription>
  </CardHeader>
  <CardContent>
    {/* محتوای اصلی */}
  </CardContent>
  <CardFooter>
    <Badge variant="success">تایید شده</Badge>
    <Button variant="outline" size="sm">تغییر</Button>
  </CardFooter>
</Card>
```

### Badge
```tsx
<Badge variant="primary" size="sm">فعال</Badge>
<Badge variant="destructive">غیرفعال</Badge>
<Badge variant="warning">در انتظار</Badge>
```

### Button
```tsx
<Button variant="primary" size="lg" fullWidth onPress={handleSave}>
  ذخیره
</Button>
<Button variant="outline" size="icon">
  <Icon name="menu" />
</Button>
```

### Skeleton / SkeletonText
```tsx
<Skeleton className="h-4 w-full rounded-lg" />
<SkeletonText lines={3} />
```

### BottomSheet
```tsx
<BottomSheet isOpen={isOpen} onClose={onClose} snapPoints={[2, 3, 4]}>
  <Text className="font-vazirmatn text-lg font-bold p-4">منویعملیات</Text>
</BottomSheet>
```

## ۶. رنگ‌ها و توکن‌ها

```tsx
import { colors, semanticColors } from './src/design-system/tokens/colors';

semanticColors.primary    // emerald-600
semanticColors.background // slate-50
semanticColors.foreground // slate-900
```

همه رنگ‌ها WCWAG AA/AAA را رعایت می‌کنند (کントラスト بالا).

## ۷. ساختار فایل‌ها

```
nir-mobile/
  src/
    design-system/
      tokens/
        colors.ts
        typography.ts
        spacing.ts
        radii.ts
        shadows.ts
      theme/
        tailwind.config.ts
        rtl.ts
      utils/
        cn.ts
        cva.ts
      components/
        Card.tsx
        Badge.tsx
        Button.tsx
        BottomSheet.tsx
        Skeleton.tsx
      index.ts
    examples/
      RoleDashboard.tsx
```

## ۸. پشتیبانی نقش‌ها

تمام کامپوننت‌ها Props یکسانی دارند و برای چهار گروه زیر قابل استفاده است:
- **مدیر (admin)** – پنل مدیریت کل، گزارش‌ها، مدیریت کاربران
- **مرغدار (farmer)** – داشبورد مرغ‌دار، تولیدات، سفارشات
- **راننده (driver)** – المسات، membrane تحویل، مسیرها
- **اپراتور باسکول (operator)** – وزن‌گیری، ورودی/خروجی، تایید حمل

همگی با یک تم (Slate/Emerald، Vazirmatn، RTL) ظاهری کاملاً یکدست دارند.