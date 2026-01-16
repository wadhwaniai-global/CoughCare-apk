import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import HomeScreen from '../screens/HomeScreen';
import ConsentScreen from '../screens/ConsentScreen';
import QuestionsScreen from '../screens/QuestionsScreen';
import CoughRecorderScreen from '../screens/CoughRecorderScreen';
import AnalyzingScreen from '../screens/AnalyzingScreen';
import ResultScreen from '../screens/ResultScreen';
import TbResultScreen from '../screens/TbResultScreen';
import ChatbotScreen from '../screens/ChatbotScreen';
import LoginScreen from '../screens/LoginScreen';

import DashboardScreen from '../screens/DashboardScreen';
import NewParticipantScreen from '../screens/NewParticipantScreen';
import ViewRecordScreen from '../screens/ViewRecordScreen';
import PendingResultsScreen from '../screens/PendingResultsScreen';
import ViewDraftsScreen from '../screens/ViewDraftsScreen';
import AddTestResultsScreen from '../screens/AddTestResultsScreen';

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  NewParticipant: undefined;
  ViewRecord: { participantId: string };
  PendingResults: undefined;
  ViewDrafts: undefined;
  AddTestResults: { participantId: string };
  Home: undefined;
  Consent: undefined;
  Assessment: { reset?: boolean } | undefined;
  RecordCough: undefined;
  Analyzing: { audioUri: string };
  Result: { result: any };
  TbResult: { result: any };
  Analysis: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Auth Stack (Login screen)
function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade',
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

// App Stack (Main application screens)
function AppStack() {
  return (
    <Stack.Navigator
      initialRouteName="Dashboard"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="NewParticipant" component={NewParticipantScreen} />
      <Stack.Screen name="ViewRecord" component={ViewRecordScreen} />
      <Stack.Screen name="PendingResults" component={PendingResultsScreen} />
      <Stack.Screen name="ViewDrafts" component={ViewDraftsScreen} />
      <Stack.Screen name="AddTestResults" component={AddTestResultsScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Consent" component={ConsentScreen} />
      <Stack.Screen name="Assessment" component={QuestionsScreen} />
      <Stack.Screen name="RecordCough" component={CoughRecorderScreen} />
      <Stack.Screen name="Analyzing" component={AnalyzingScreen} />
      <Stack.Screen name="Result" component={ResultScreen} />
      <Stack.Screen name="TbResult" component={TbResultScreen} />
      <Stack.Screen name="Analysis" component={ChatbotScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading indicator while checking auth state
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#158B95' }}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  // Show auth stack if not authenticated, app stack if authenticated
  return isAuthenticated ? <AppStack /> : <AuthStack />;
}

