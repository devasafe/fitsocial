// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet, Session } from "../api/plans";
import type { Post } from "../api/social";

export type AuthStackParams = {
  Login: undefined;
  Register: undefined;
};

// Stack principal (quando logado e com onboarding concluído).
export type AppStackParams = {
  ChooseUsername: undefined;
  OnboardingChat: undefined;
  Tabs: undefined;
  TodayWorkout: undefined;
  Workout: { workout: Workout };
  Diet: { diet: Diet };
  CheckIn: { session: Session };
  CreatePost: undefined;
  EditProfile: undefined;
  UserProfile: { userId: string };
  Subscription: undefined;
  Leaderboard: undefined;
  PostDetail: { post: Post };
  ImportPlan: undefined;
  History: undefined;
  // Registro de atividade multiesporte (Fase 2a).
  Registrar: undefined;
  RegisterActivity: { sportId: string };
};

// Abas inferiores dentro de "Tabs": Hoje · Feed · (+) · Coach · Perfil.
// "RegisterTab" não é uma aba de conteúdo — é o botão central de registrar.
export type MainTabParams = {
  HomeTab: undefined;
  FeedTab: undefined;
  RegisterTab: undefined;
  CoachTab: undefined;
  ProfileTab: undefined;
};
