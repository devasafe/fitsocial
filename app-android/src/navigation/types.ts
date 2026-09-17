// Tipos das rotas de navegação, compartilhados entre telas e navegadores.
import type { Workout, Diet, Session } from "../api/plans";
import type { Post } from "../api/social";
import type { Activity, NewPR } from "../api/activities";
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
  /** `prescritoPor` só existe quando o treino é de um profissional — e é ele
   *  que tira o botão de editar: quem mudaria o treino é quem o escreveu. */
  Workout: { workout: Workout; prescritoPor?: string };
  Diet: { diet: Diet };
  EditWorkout: undefined;
  EditDiet: undefined;
  CheckIn: { session: Session };
  /** Destino de todo treino salvo, em qualquer esporte. O treino já existe
   *  quando esta rota abre — daí não haver caminho de volta ao formulário. */
  TreinoConcluido: { activity: Activity; newPRs?: NewPR[] };
  CreatePost: { activity?: Activity; newPRs?: NewPR[] } | undefined;
  EditProfile: undefined;
  /** A ficha (objetivo, dias de treino, restrições...) — separada de
   *  EditProfile, que é identidade (nome, foto, bio). */
  Ficha: undefined;
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
  AceitarConvite: { code: string };
  Acompanhamentos: undefined;
  Conversa: { linkId: string; nome: string };
  ActivityDetail: { activity?: Activity; activityId?: string };
  /** Corrigir o próprio treino (Tarefa 7). Só o dono chega aqui — a entrada
   *  vive no menu do detalhe. Precisa da atividade inteira, não só do id: é
   *  o que preenche o formulário sem uma segunda ida à rede. */
  EditarTreino: { activity: Activity };
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
  /** O treino de hoje (ou a semana, ou a tela de encaixe de dias). É o que o
   *  "+" abre para musculação, em vez do formulário em branco. */
  TreinoDoDia: { sportId: string };
  RefeicaoPorFoto: { meal?: "cafe" | "almoco" | "lanche" | "janta"; data?: string } | undefined;
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
