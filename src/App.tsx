import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './navigation/AppNavigator';
import { useAppFonts } from './hooks/useAppFonts';
import { View, ActivityIndicator, Platform } from 'react-native';
import { api } from './utils/api';
import { AuthProvider } from './contexts/AuthContext';
import NetInfo from '@react-native-community/netinfo';
import { syncService } from './services/SyncService';

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

  // Auto-sync when coming online
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: use window online/offline events
      const handleOnline = () => {
        console.log('[App] Device came online, triggering sync...');
        syncService.syncPendingForms().catch(console.error);
      };

      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
    } else {
      // React Native: use NetInfo
      const unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected && !syncService.getIsSyncing()) {
          console.log('[App] Device came online, triggering sync...');
          syncService.syncPendingForms().catch(console.error);
        }
      });

      return () => unsubscribe();
    }
  }, []);

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
        <NavigationContainer>
          <StatusBar style="auto" />
          <AppNavigator />
        </NavigationContainer>
      </GestureHandlerRootView>
    </AuthProvider>
  );
}
