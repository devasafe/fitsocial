/**
 * Base de conhecimento curada que "aterra" a IA na geração de planos.
 * Aqui é onde você (ou um educador físico/nutricionista) define os princípios
 * que o app segue — trocar/expandir é só editar este texto. No futuro (v2),
 * isto pode virar uma base vetorial (RAG). Mantenha em português.
 */
export const TRAINING_KNOWLEDGE = `PRINCÍPIOS DE TREINO:
- Iniciantes: full body 2-3x/semana, foco em técnica e exercícios básicos; progressão de carga gradual.
- Intermediários: divisões tipo upper/lower ou ABC, 3-5x/semana.
- Avançados: divisões ABCDE ou específicas por objetivo, maior volume.
- Sempre incluir aquecimento; hipertrofia costuma usar 8-12 reps, força 3-6 reps, resistência 12-20 reps.
- Respeitar dias disponíveis e minutos por sessão informados (não montar treino que não cabe no tempo).
- LESÕES/DOR: nunca prescrever exercícios que sobrecarreguem a região afetada; ofereça alternativas seguras.`;

export const NUTRITION_KNOWLEDGE = `PRINCÍPIOS DE NUTRIÇÃO:
- Estimar calorias a partir de sexo, idade, peso, altura e nível de atividade (Mifflin-St Jeor + fator de atividade).
- Perder gordura: déficit calórico moderado (~15-20%). Ganhar massa: leve superávit (~10%). Saúde/manutenção: manutenção.
- Proteína ~1.6-2.2 g/kg de peso; distribuir ao longo das refeições.
- Respeitar SEMPRE as restrições alimentares informadas (não sugerir alimentos proibidos).
- Priorizar alimentos comuns e acessíveis no Brasil; refeições realistas.`;

export const SAFETY_DISCLAIMER =
  "Este plano é um ponto de partida gerado por IA e NÃO substitui a orientação de um médico, nutricionista ou educador físico. Consulte um profissional antes de iniciar, especialmente se tiver condições de saúde.";
