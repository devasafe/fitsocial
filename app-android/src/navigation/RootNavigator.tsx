import React from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator, type BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { useAuth } from "../context/AuthContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { OnboardingForm } from "../screens/OnboardingForm";
import { WorkoutScreen } from "../screens/WorkoutScreen";
import { DietScreen } from "../screens/DietScreen";
import { ComunidadeScreen } from "../screens/ComunidadeScreen";
import { ProgressoScreen } from "../screens/ProgressoScreen";
import { CreatePostScreen } from "../screens/CreatePostScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { CheckInScreen } from "../screens/CheckInScreen";
import { LeaderboardScreen } from "../screens/LeaderboardScreen";
import { PostDetailScreen } from "../screens/PostDetailScreen";
import { CoachScreen } from "../screens/CoachScreen";
import { ImportPlanScreen } from "../screens/ImportPlanScreen";
import { TodayWorkoutScreen } from "../screens/TodayWorkoutScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { ChooseUsernameScreen } from "../screens/ChooseUsernameScreen";
import { EditProfileScreen } from "../screens/EditProfileScreen";
import { RegistrarScreen } from "../screens/RegistrarScreen";
import { RegisterActivityScreen } from "../screens/RegisterActivityScreen";
import { RegisterEnduranceScreen } from "../screens/RegisterEnduranceScreen";
import { RegisterClassScreen } from "../screens/RegisterClassScreen";
import { RegisterGenericScreen } from "../screens/RegisterGenericScreen";
import { RegisterWodScreen } from "../screens/RegisterWodScreen";
import { LiveTrackScreen } from "../screens/LiveTrackScreen";
import { MeusPRsScreen } from "../screens/MeusPRsScreen";
import { MinhasAtividadesScreen } from "../screens/MinhasAtividadesScreen";
import { ActivityDetailScreen } from "../screens/ActivityDetailScreen";
import { DesafiosScreen } from "../screens/DesafiosScreen";
import { CriarDesafioScreen } from "../screens/CriarDesafioScreen";
import { DesafioDetailScreen } from "../screens/DesafioDetailScreen";
import { DiarioScreen } from "../screens/DiarioScreen";
import { NotificacoesScreen } from "../screens/NotificacoesScreen";
import { BuscarPessoasScreen } from "../screens/BuscarPessoasScreen";
import type { AuthStackParams, AppStackParams, MainTabParams } from "./types";
import { colors } from "../theme";

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const AppStack = createNativeStackNavigator<AppStackParams>();
const Tab = createBottomTabNavigator<MainTabParams>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

const headerStyle = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerShadowVisible: false,
} as const;

function tabIcon(emoji: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

// Botão central lima elevado — a única peça com brilho (brief §2.7). Não é aba:
// abre a folha de registrar atividade.
function CenterTabButton({ onPress }: BottomTabBarButtonProps) {
  return (
    <View style={styles.centerWrap}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Registrar treino"
        activeOpacity={0.85}
        onPress={(e) => onPress?.(e)}
        style={styles.centerFab}
      >
        <Text style={styles.centerPlus}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const EmptyTab = () => null;

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.lime,
        tabBarInactiveTintColor: colors.text2,
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: "Hoje", tabBarIcon: tabIcon("◆") }} />
      <Tab.Screen name="ProgressoTab" component={ProgressoScreen} options={{ title: "Progresso", tabBarIcon: tabIcon("▲") }} />
      <Tab.Screen
        name="RegisterTab"
        component={EmptyTab}
        options={{ title: "", tabBarButton: (p) => <CenterTabButton {...p} /> }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.getParent()?.navigate("Registrar");
          },
        })}
      />
      <Tab.Screen name="ComunidadeTab" component={ComunidadeScreen} options={{ title: "Comunidade", tabBarIcon: tabIcon("❒") }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Perfil", tabBarIcon: tabIcon("●") }} />
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
        <AppStack.Screen name="Onboarding" component={OnboardingForm} />
      ) : (
        <>
          <AppStack.Screen name="Tabs" component={MainTabs} />
          <AppStack.Screen
            name="Registrar"
            component={RegistrarScreen}
            options={{ presentation: "modal" }}
          />
          <AppStack.Screen
            name="RegisterActivity"
            component={RegisterActivityScreen}
            options={{ headerShown: true, title: "Novo treino", ...headerStyle }}
          />
          <AppStack.Screen
            name="RegisterEndurance"
            component={RegisterEnduranceScreen}
            options={{ headerShown: true, title: "Nova atividade", ...headerStyle }}
          />
          <AppStack.Screen
            name="RegisterClass"
            component={RegisterClassScreen}
            options={{ headerShown: true, title: "Nova atividade", ...headerStyle }}
          />
          <AppStack.Screen
            name="RegisterGeneric"
            component={RegisterGenericScreen}
            options={{ headerShown: true, title: "Nova atividade", ...headerStyle }}
          />
          <AppStack.Screen
            name="RegisterWod"
            component={RegisterWodScreen}
            options={{ headerShown: true, title: "Novo WOD", ...headerStyle }}
          />
          <AppStack.Screen
            name="LiveTrack"
            component={LiveTrackScreen}
            options={{ headerShown: true, title: "Gravar percurso", ...headerStyle }}
          />
          <AppStack.Screen
            name="TodayWorkout"
            component={TodayWorkoutScreen}
            options={{ headerShown: true, title: "Treino de hoje", ...headerStyle }}
          />
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
            name="EditProfile"
            component={EditProfileScreen}
            options={{ headerShown: true, title: "Editar perfil", ...headerStyle }}
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
            options={{ headerShown: true, title: "Treino de hoje", ...headerStyle }}
          />
          <AppStack.Screen
            name="Leaderboard"
            component={LeaderboardScreen}
            options={{ headerShown: true, title: "Ranking", ...headerStyle }}
          />
          <AppStack.Screen
            name="PostDetail"
            component={PostDetailScreen}
            options={{ headerShown: true, title: "Post", ...headerStyle }}
          />
          <AppStack.Screen
            name="ImportPlan"
            component={ImportPlanScreen}
            options={{ headerShown: true, title: "Importar plano", ...headerStyle }}
          />
          <AppStack.Screen
            name="History"
            component={HistoryScreen}
            options={{ headerShown: true, title: "Histórico", ...headerStyle }}
          />
          <AppStack.Screen
            name="MeusPRs"
            component={MeusPRsScreen}
            options={{ headerShown: true, title: "Meus recordes", ...headerStyle }}
          />
          <AppStack.Screen
            name="MinhasAtividades"
            component={MinhasAtividadesScreen}
            options={{ headerShown: true, title: "Minhas atividades", ...headerStyle }}
          />
          <AppStack.Screen
            name="ActivityDetail"
            component={ActivityDetailScreen}
            options={{ headerShown: true, title: "Atividade", ...headerStyle }}
          />
          <AppStack.Screen
            name="Desafios"
            component={DesafiosScreen}
            options={{ headerShown: true, title: "Desafios", ...headerStyle }}
          />
          <AppStack.Screen
            name="CriarDesafio"
            component={CriarDesafioScreen}
            options={{ headerShown: true, title: "Criar desafio", ...headerStyle }}
          />
          <AppStack.Screen
            name="DesafioDetail"
            component={DesafioDetailScreen}
            options={{ headerShown: true, title: "Desafio", ...headerStyle }}
          />
          <AppStack.Screen
            name="Diario"
            component={DiarioScreen}
            options={{ headerShown: true, title: "Diário alimentar", ...headerStyle }}
          />
          <AppStack.Screen
            name="Notificacoes"
            component={NotificacoesScreen}
            options={{ headerShown: true, title: "Notificações", ...headerStyle }}
          />
          <AppStack.Screen
            name="Coach"
            component={CoachScreen}
            options={{ headerShown: true, title: "Seu coach", presentation: "modal", ...headerStyle }}
          />
          <AppStack.Screen
            name="BuscarPessoas"
            component={BuscarPessoasScreen}
            options={{ headerShown: true, title: "Buscar pessoas", ...headerStyle }}
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
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {token ? (
        !user?.username ? (
          <AppStack.Navigator screenOptions={{ headerShown: false }}>
            <AppStack.Screen name="ChooseUsername" component={ChooseUsernameScreen} />
          </AppStack.Navigator>
        ) : (
          <AppFlow needsOnboarding={!user?.onboardingComplete} />
        )
      ) : (
        <AuthFlow />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerFab: {
    position: "absolute",
    bottom: 4,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.lime,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.lime,
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  centerPlus: { fontSize: 30, lineHeight: 32, color: colors.onLime },
});
