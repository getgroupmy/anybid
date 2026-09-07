import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../src/lib/auth';
import { colors } from '../src/lib/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700', fontSize: 16 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="listing/[id]" options={{ title: '' }} />
            <Stack.Screen
              name="auth/sign-in"
              options={{ title: 'Sign in', presentation: 'modal' }}
            />
            <Stack.Screen
              name="auth/register"
              options={{ title: 'Create account', presentation: 'modal' }}
            />
            <Stack.Screen name="console/admin" options={{ title: 'Admin Console' }} />
            <Stack.Screen name="console/advertiser" options={{ title: 'Advertiser Console' }} />
            <Stack.Screen name="console/corporate" options={{ title: 'Corporate Console' }} />
            <Stack.Screen name="orders" options={{ title: 'My purchases' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
