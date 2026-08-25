import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { TestBuildBanner } from './components/ui/TestBuildBanner';
import AppNavigator from './navigation/AppNavigator';
import { useAppFonts } from './hooks/useAppFonts';
import { View, ActivityIndicator, Platform } from 'react-native';
import { api } from './utils/api';
import { AuthProvider } from './contexts/AuthContext';

import { initDatabase } from './services/DatabaseService';

export default function App() {
  const fontsLoaded = useAppFonts();

  // Initialize DB and pre-load ONNX models
  useEffect(() => {
    initDatabase().catch(console.error);

    if (Platform.OS === 'web') {
      api.initClientONNX().catch(console.warn);
    }
  }, []);

  // NOTE (2026-08-20): automatic sync-on-connectivity was removed on purpose.
  // Pending records can be corrected until they are synced, and the Sync
  // button now asks for confirmation ("records cannot be edited after sync").
  // A background auto-sync would silently bypass both. Syncing is manual via
  // the Dashboard Sync button.

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#158B95" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* In layout flow above the navigator: pushes screens down in
              test-channel builds; renders nothing in field builds */}
          <TestBuildBanner />
          <NavigationContainer>
            <StatusBar style="auto" />
            <AppNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AuthProvider>
  );
}
