// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet, Session } from "../api/plans";
import type { Post } from "../api/social";
import type { Activity } from "../api/activities";

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
  MeusPRs: undefined;
  MinhasAtividades: undefined;
  ActivityDetail: { activity: Activity };
  Desafios: undefined;
  CriarDesafio: undefined;
  DesafioDetail: { id: string };
  Diario: undefined;
  Notificacoes: undefined;
  // Registro de atividade multiesporte (Fase 2a/2b).
  Registrar: undefined;
  RegisterActivity: { sportId: string };
  RegisterEndurance: { sportId: string };
  RegisterClass: { sportId: string };
  RegisterGeneric: { sportId: string };
  RegisterWod: { sportId: string };
  LiveTrack: { sportId: string };
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
