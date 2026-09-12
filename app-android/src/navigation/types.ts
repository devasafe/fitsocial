// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet, Session } from "../api/plans";
import type { Post } from "../api/social";
import type { Activity } from "../api/activities";
import type { MuscleGroup } from "../api/library";

export type AuthStackParams = {
  Login: undefined;
  Register: undefined;
  EsqueciSenha: undefined;
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
  Configuracoes: undefined;
  AlterarSenha: undefined;
  ExcluirConta: undefined;
  UserProfile: { userId: string };
  Subscription: undefined;
  Leaderboard: undefined;
  EditarPost: { post: Post };
  PostDetail: { post: Post };
  ImportPlan: undefined;
  History: undefined;
  MeusPRs: undefined;
  Benchmarks: undefined;
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
  RefeicaoPorFoto: { meal?: "cafe" | "almoco" | "lanche" | "janta" } | undefined;
  RegisterActivity: {
    sportId: string;
    // "Repetir último": pré-preenche os exercícios/séries a partir do último treino.
    // Leva também o vínculo com o catálogo — sem ele, repetir um treino
    // transformava exercícios escolhidos da lista em nomes digitados, e a tela
    // abria perguntando o músculo de coisa que ela já sabia.
    prefill?: {
      name: string;
      sets: { weightKg: string; reps: string }[];
      exerciseId?: string | null;
      muscle?: MuscleGroup | null;
    }[];
  };
  RegisterEndurance: { sportId: string };
  RegisterClass: { sportId: string };
  RegisterGeneric: { sportId: string };
  RegisterCrossfit: { sportId: string };
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
