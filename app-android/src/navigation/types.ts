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
  Onboarding: undefined;
  Tabs: undefined;
  TodayWorkout: undefined;
  Workout: { workout: Workout };
  Diet: { diet: Diet };
  EditWorkout: undefined;
  EditDiet: undefined;
  CheckIn: { session: Session };
  CreatePost: { activity?: Activity } | undefined;
  EditProfile: undefined;
  UserProfile: { userId: string };
  Subscription: undefined;
  Leaderboard: undefined;
  PostDetail: { post: Post };
  ImportPlan: undefined;
  History: undefined;
  MeusPRs: undefined;
  MinhasAtividades: undefined;
  ActivityDetail: { activity?: Activity; activityId?: string };
  Desafios: undefined;
  CriarDesafio: undefined;
  DesafioDetail: { id: string };
  Diario: undefined;
  Agua: undefined;
  Notificacoes: undefined;
  Coach: undefined;
  BuscarPessoas: undefined;
  // Registro de atividade multiesporte (Fase 2a/2b).
  Registrar: undefined;
  RegisterActivity: {
    sportId: string;
    // "Repetir último": pré-preenche os exercícios/séries a partir do último treino.
    prefill?: { name: string; sets: { weightKg: string; reps: string }[] }[];
  };
  RegisterEndurance: { sportId: string };
  RegisterClass: { sportId: string };
  RegisterGeneric: { sportId: string };
  RegisterWod: { sportId: string };
  LiveTrack: { sportId: string };
};

// Abas inferiores dentro de "Tabs": Hoje · Progresso · (+) · Comunidade · Perfil.
// "RegisterTab" não é uma aba de conteúdo — é o botão central de registrar.
// Coach saiu da barra: virou camada transversal (acesso pelo header da Home).
export type MainTabParams = {
  HomeTab: undefined;
  ProgressoTab: undefined;
  RegisterTab: undefined;
  ComunidadeTab: undefined;
  ProfileTab: undefined;
};
