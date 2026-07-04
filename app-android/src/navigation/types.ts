// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet } from "../api/plans";

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
  CreatePost: undefined;
  UserProfile: { userId: string };
  Subscription: undefined;
};

// Abas inferiores dentro de "Tabs".
export type MainTabParams = {
  HomeTab: undefined;
  FeedTab: undefined;
  ProfileTab: undefined;
};
