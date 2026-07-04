import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useAuth } from "../context/AuthContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { OnboardingChat } from "../screens/OnboardingChat";
import { WorkoutScreen } from "../screens/WorkoutScreen";
import { DietScreen } from "../screens/DietScreen";
import { FeedScreen } from "../screens/FeedScreen";
import { CreatePostScreen } from "../screens/CreatePostScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { CheckInScreen } from "../screens/CheckInScreen";
import type { AuthStackParams, AppStackParams, MainTabParams } from "./types";
import { colors } from "../theme";

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const AppStack = createNativeStackNavigator<AppStackParams>();
const Tab = createBottomTabNavigator<MainTabParams>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

// Header escuro reutilizado nas telas internas (Treino/Dieta/etc.).
const headerStyle = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerShadowVisible: false,
} as const;

function tabIcon(emoji: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Início", tabBarIcon: tabIcon("🏠") }}
      />
      <Tab.Screen
        name="FeedTab"
        component={FeedScreen}
        options={{ title: "Feed", tabBarIcon: tabIcon("🔥") }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: "Perfil", tabBarIcon: tabIcon("👤") }}
      />
    </Tab.Navigator>
  );
}

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function AppFlow({ needsOnboarding }: { needsOnboarding: boolean }) {
  return (
    <AppStack.Navigator screenOptions={{ headerShown: false }}>
      {needsOnboarding ? (
        <AppStack.Screen name="OnboardingChat" component={OnboardingChat} />
      ) : (
        <>
          <AppStack.Screen name="Tabs" component={MainTabs} />
          <AppStack.Screen
            name="Workout"
            component={WorkoutScreen}
            options={{ headerShown: true, title: "Meu treino", ...headerStyle }}
          />
          <AppStack.Screen
            name="Diet"
            component={DietScreen}
            options={{ headerShown: true, title: "Minha dieta", ...headerStyle }}
          />
          <AppStack.Screen
            name="CreatePost"
            component={CreatePostScreen}
            options={{ headerShown: true, title: "Novo post", ...headerStyle }}
          />
          <AppStack.Screen
            name="UserProfile"
            component={ProfileScreen}
            options={{ headerShown: true, title: "Perfil", ...headerStyle }}
          />
          <AppStack.Screen
            name="Subscription"
            component={SubscriptionScreen}
            options={{ headerShown: true, title: "Premium", ...headerStyle }}
          />
          <AppStack.Screen
            name="CheckIn"
            component={CheckInScreen}
            options={{ headerShown: true, title: "Concluir treino", ...headerStyle }}
          />
        </>
      )}
    </AppStack.Navigator>
  );
}

export function RootNavigator() {
  const { token, user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {token ? (
        <AppFlow needsOnboarding={!user?.onboardingComplete} />
      ) : (
        <AuthFlow />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
});
