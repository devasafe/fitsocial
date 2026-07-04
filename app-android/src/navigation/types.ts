// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet, Session } from "../api/plans";
import type { Post } from "../api/social";

export type AuthStackParams = {
  Login: undefined;
  Register: undefined;
};

// Stack principal (quando logado e com onboarding concluído).
export type AppStackParams = {
  OnboardingChat: undefined;
  Tabs: undefined;
  Workout: { workout: Workout };
  Diet: { diet: Diet };
  CheckIn: { session: Session };
  CreatePost: undefined;
  UserProfile: { userId: string };
  Subscription: undefined;
  Leaderboard: undefined;
  PostDetail: { post: Post };
  ImportPlan: undefined;
};

// Abas inferiores dentro de "Tabs".
export type MainTabParams = {
  HomeTab: undefined;
  WorkoutTab: undefined;
  CoachTab: undefined;
  FeedTab: undefined;
  ProfileTab: undefined;
};
