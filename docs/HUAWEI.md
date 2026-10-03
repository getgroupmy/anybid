# Building for Huawei AppGallery

Huawei devices sold since 2019 ship **without Google Mobile Services**. An
Android build that depends on GMS — Google Maps, Play Services location, Firebase
Cloud Messaging, Play Integrity — installs on those devices but fails at runtime.

AnyBid is built so the same source produces a working AppGallery build. This
document is the whole story.

## What the app deliberately does not use

| Common dependency | Why AnyBid avoids it | What it uses instead |
|---|---|---|
| `react-native-maps` | Google Maps SDK needs GMS | Location is a state/city string; listings show text, not a map |
| `expo-location` (Play Services provider) | Fused location needs GMS | Buyers pick a state from a list |
| Firebase / FCM | Needs GMS | Push abstraction — Expo push on Play, Huawei Push Kit on AppGallery |
| Google Sign-In | Needs GMS | Email and password, on the platform's own auth |
| Play Billing | Not on AppGallery | Payments are server-side (FPX/card), not in-app purchase |

Everything else in the dependency list — `expo-router`, `expo-image`,
`expo-image-picker`, `expo-image-manipulator`, `expo-secure-store`,
`expo-haptics`, `react-native-screens`, `react-native-safe-area-context`,
`react-native-gesture-handler` — is GMS-free and runs on Huawei unchanged.

### One GMS-named manifest entry that is not a GMS dependency

`expo-image-picker` contributes this to the merged manifest, and anyone
auditing the AppGallery build will find it:

```xml
<service
  android:name="com.google.android.gms.metadata.ModuleDependencies"
  android:enabled="false"
  tools:ignore="MissingClass">
  <meta-data android:name="photopicker_activity:0:required" android:value="" />
</service>
```

It is not a dependency and nothing links against it. On Android 11 and 12 the
system photo picker is delivered as a Play Services module, and this disabled,
class-less entry is how an app asks GMS to provision it. Checked against the
library's `android/build.gradle`, whose only dependencies are `androidx.*`,
`kotlinx-coroutines` and `com.vanniktech:android-image-cropper` — no Play
Services artifact anywhere. On a device with no GMS the entry is inert and the
picker falls back to the platform's document picker, so photo selection works.

`expo-image-manipulator` declares one dependency, `androidx.annotation`, and
mentions GMS nowhere.

The exported Huawei bundle contains no `play-services`, `com.google.android.gms`
or Firebase reference. The one `firebase` string a search turns up is
`logo-firebase`, a glyph name inside `@expo/vector-icons`.

## The two channels

`EXPO_PUBLIC_DIST_CHANNEL` selects the variant, read in `app.config.ts`:

| | `google` (default) | `huawei` |
|---|---|---|
| Application id | `my.anybid.app` | `my.anybid.app.huawei` |
| `expo-notifications` plugin | included | **omitted** |
| Push transport | Expo push service | Huawei Push Kit |
| Store | Play Store / App Store | AppGallery |

A separate application id lets both builds sit on one device during testing.

## Push notifications

`apps/mobile/src/lib/push.ts` is the only file that knows there are two push
systems:

```ts
export async function registerForPush(): Promise<PushRegistration | null>
```

On the Play build it asks `expo-notifications` for a token. On the AppGallery
build it calls `HmsPushBridge.getToken()` — a small native module linked only
into that variant. Both return `{ provider, token }`, so nothing above this file
branches on the channel.

## Building the AppGallery APK

```bash
cd apps/mobile

# 1. Remove the FCM-bearing dependency so nothing links Google Play Services.
npm run strip:gms

# 2. Generate the native project for the Huawei variant.
npm run prebuild:huawei

# 3. Add the Huawei bits to the generated android/ project:
#      - agconnect-services.json from AppGallery Connect  ->  android/app/
#      - the AppGallery Connect + HMS Push Kit Gradle plugins
#      - a native module exposing HmsPushBridge.getToken()

# 4. Build.
npm run build:huawei          # EAS, profile "huawei" (APK)
# or, locally:
cd android && ./gradlew assembleRelease
```

Step 3 is manual because it needs your AppGallery Connect credentials.
`eas.json` already carries the `huawei` profile, which sets
`EXPO_PUBLIC_DIST_CHANNEL=huawei` and produces an APK — AppGallery takes APKs,
not the AAB the Play profile produces.

## Verifying a build is GMS-free

After `prebuild`, from `apps/mobile/android`:

```bash
./gradlew :app:dependencies --configuration releaseRuntimeClasspath \
  | grep -iE 'play-services|firebase|com.google.android.gms'
```

Nothing should come back. If something does, an added dependency reintroduced
GMS — find it before submitting.

On a real Huawei device, confirm the app launches, browses, bids over the
WebSocket, and receives a push through Push Kit. The bidding path uses only
HTTPS and WebSocket, so it behaves identically on all three targets.

## Submitting

- **AppGallery** — upload the APK in AppGallery Connect. Declare the permissions
  in `app.config.ts` (`INTERNET`, `READ_MEDIA_IMAGES`). The listing needs a
  privacy policy URL and the app must not reference Google Play.
- **Play Store** — `npm run build:android` (AAB, `my.anybid.app`).
- **App Store** — `npm run build:ios`. iOS is unaffected by any of the above;
  `blockedPermissions` and the GMS discussion are Android-only.
