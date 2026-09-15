import { describe, it, expect } from "vitest";
import {
  preservarAgenda,
  sugerirWeekdays,
  normalizarWeekdays,
  agendaPorDia,
  sessoesSemDia,
  atribuirDias,
  montarPlanoDoDia,
  aplicarAgenda,
} from "./agendaDeTreino.js";
import { diaDaSemana } from "../utils/dia.js";
import type { WorkoutData } from "../models/Plan.js";

function sessao(day: string, weekdays?: number[]) {
  return {
    day,
    focus: "",
    exercises: [{ name: "Agachamento livre", sets: 3, reps: "8-12", restSeconds: 90, notes: "" }],
    ...(weekdays === undefined ? {} : { weekdays }),
  };
}

function treino(...sessions: ReturnType<typeof sessao>[]): WorkoutData {
  return { split: "ABC", daysPerWeek: sessions.length, sessions };
}

/** Os dias de cada sessão do treino, na ordem das sessões. */
function dias(w: WorkoutData): (number[] | undefined)[] {
  return w.sessions.map((s) => s.weekdays);
}

describe("normalizarWeekdays", () => {
  it("tira repetido e ordena", () => {
    expect(normalizarWeekdays([4, 1, 4, 0])).toEqual([0, 1, 4]);
  });

  it("descarta o que não é dia da semana", () => {
    expect(normalizarWeekdays([7, -1, 2, 1.5])).toEqual([2]);
  });

  it("trata ausente e vazio como a mesma coisa", () => {
    expect(normalizarWeekdays(undefined)).toEqual([]);
    expect(normalizarWeekdays([])).toEqual([]);
  });
});

describe("sugerirWeekdays", () => {
  it("lê o dia escrito por extenso, com ou sem acento e caixa", () => {
    expect(sugerirWeekdays("Segunda")).toEqual([1]);
    expect(sugerirWeekdays("segunda")).toEqual([1]);
    expect(sugerirWeekdays("SEGUNDA")).toEqual([1]);
    expect(sugerirWeekdays("Terça-feira")).toEqual([2]);
    expect(sugerirWeekdays("terca")).toEqual([2]);
    expect(sugerirWeekdays("Sábado")).toEqual([6]);
  });

  it("lê a abreviação", () => {
    expect(sugerirWeekdays("Seg")).toEqual([1]);
    expect(sugerirWeekdays("Qui — pernas")).toEqual([4]);
  });

  it("lê dois dias no mesmo nome", () => {
    expect(sugerirWeekdays("Seg/Qui")).toEqual([1, 4]);
  });

  it("não inventa dia onde não há", () => {
    // Os nomes que a IA gera hoje. Sugerir aqui seria pior que não sugerir:
    // um palpite errado faz a pessoa treinar o treino errado na terça.
    expect(sugerirWeekdays("Dia A")).toEqual([]);
    expect(sugerirWeekdays("Dia 2")).toEqual([]);
    expect(sugerirWeekdays("Dia A — Peito e Tríceps")).toEqual([]);
    expect(sugerirWeekdays("")).toEqual([]);
  });

  it("não casa abreviação dentro de outra palavra", () => {
    // Sem borda de palavra, "ter" casaria aqui e o treino intervalado viraria
    // treino de terça.
    expect(sugerirWeekdays("Intervalado")).toEqual([]);
    expect(sugerirWeekdays("Domada de barra")).toEqual([]);
  });
});

describe("preservarAgenda", () => {
  it("herda o dia quando quem reescreve não conhece o campo", () => {
    // É o APK instalado: manda {day, focus, exercises} e nada mais.
    const anterior = treino(sessao("Dia A", [1]), sessao("Dia B", [4]));
    const novo = treino(sessao("Dia A"), sessao("Dia B"));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[1], [4]]);
  });

  it("respeita quem limpou de propósito", () => {
    const anterior = treino(sessao("Dia A", [1]));
    const novo = treino(sessao("Dia A", []));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[]]);
  });

  it("respeita o dia novo quando ele vem explícito", () => {
    const anterior = treino(sessao("Dia A", [1]));
    const novo = treino(sessao("Dia A", [3]));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[3]]);
  });

  it("casa o nome ignorando caixa e espaço nas pontas", () => {
    const anterior = treino(sessao("Dia A", [1]));
    const novo = treino(sessao("  dia a  "));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[1]]);
  });

  it("sessão renomeada perde o dia, e o resto continua", () => {
    // Custo conhecido de casar por texto. É visível: a pessoa está justamente
    // editando aquele nome.
    const anterior = treino(sessao("Dia A", [1]), sessao("Dia B", [4]));
    const novo = treino(sessao("Peito e tríceps"), sessao("Dia B"));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([undefined, [4]]);
  });

  it("sessão nova entra sem dia e não rouba o dia de ninguém", () => {
    const anterior = treino(sessao("Dia A", [1]));
    const novo = treino(sessao("Dia A"), sessao("Dia C"));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[1], undefined]);
  });

  it("um dia não fica em duas sessões: a última da lista leva", () => {
    const anterior = treino(sessao("Dia A", [1]), sessao("Dia B", [1, 4]));
    const novo = treino(sessao("Dia A"), sessao("Dia B"));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[], [1, 4]]);
  });

  it("o dia que o cliente MANDOU ganha do que a sessão herdou", () => {
    // Sem isto, mover "Dia B" para a segunda era desfeito pela segunda que
    // "Dia A" herdava do plano anterior — a escolha explícita evaporava.
    const anterior = treino(sessao("Dia A", [1]), sessao("Dia B", [3]));
    const novo = treino(sessao("Dia B", [1]), sessao("Dia A"));
    expect(dias(preservarAgenda(anterior, novo))).toEqual([[1], []]);
  });

  it("devolve o treino intacto quando não havia agenda antes", () => {
    const novo = treino(sessao("Dia A"));
    expect(preservarAgenda(null, novo)).toBe(novo);
    expect(preservarAgenda(treino(sessao("Dia A")), novo)).toBe(novo);
  });

  it("não muda o treino anterior nem o novo", () => {
    const anterior = treino(sessao("Dia A", [1]));
    const novo = treino(sessao("Dia A"));
    preservarAgenda(anterior, novo);
    expect(novo.sessions[0]!.weekdays).toBeUndefined();
    expect(anterior.sessions[0]!.weekdays).toEqual([1]);
  });
});

describe("atribuirDias", () => {
  it("dá o dia à sessão pedida e tira de quem o tinha, dizendo de quem tirou", () => {
    const sessions = [sessao("Dia A", [2, 5]), sessao("Dia B", [4])];
    const r = atribuirDias(sessions, 1, [2]);
    expect(r.sessions[0]!.weekdays).toEqual([5]);
    expect(r.sessions[1]!.weekdays).toEqual([2]);
    // Sem este nome, "Dia A" perderia a terça em silêncio e a pessoa só
    // descobriria na terça seguinte.
    expect(r.tomadosDe).toEqual(["Dia A"]);
  });

  it("não reporta quem não perdeu nada", () => {
    const r = atribuirDias([sessao("Dia A", [1]), sessao("Dia B")], 1, [4]);
    expect(r.tomadosDe).toEqual([]);
    expect(r.sessions[0]!.weekdays).toEqual([1]);
  });
});

describe("montarPlanoDoDia", () => {
  // A máquina de estados é a decisão mais importante da feature. Aqui ela é
  // testável sem subir Mongo.
  const completa = (s: ReturnType<typeof sessao>) => s;

  it("sem sessão nenhuma é sem_plano, e ainda assim devolve a semana inteira", () => {
    const r = montarPlanoDoDia({ split: "", daysPerWeek: 0, sessions: [] }, 3, completa);
    expect(r.estado).toBe("sem_plano");
    expect(r.semana).toHaveLength(7);
    // `sessoes` existe em todo estado: um campo que some no quarto vira
    // `undefined.length` na tela.
    expect(r.sessoes).toEqual([]);
  });

  it("nenhuma sessão com dia é sem_agenda, com índice e sugestão", () => {
    const r = montarPlanoDoDia(treino(sessao("Segunda"), sessao("Dia A")), 3, completa);
    expect(r.estado).toBe("sem_agenda");
    expect(r.sessoes[0]).toMatchObject({ indice: 0, sugestao: [1] });
    expect(r.sessoes[1]).toMatchObject({ indice: 1, sugestao: [] });
  });

  it("uma sessão agendada já tira o plano de sem_agenda", () => {
    // Um coach acrescentando uma sessão não pode jogar o aluno de volta à tela
    // de encaixe: o estado é decidido por HOJE, não por completude.
    const w = treino(sessao("Dia A", [3]), sessao("Dia B"));
    expect(montarPlanoDoDia(w, 3, completa).estado).toBe("treino_de_hoje");
    expect(montarPlanoDoDia(w, 5, completa).estado).toBe("descanso");
  });
});

describe("aplicarAgenda", () => {
  it("substitui a grade inteira: índice não citado fica sem dia", () => {
    const w = treino(sessao("Dia A", [1]), sessao("Dia B", [4]));
    const r = aplicarAgenda(w, [{ indice: 0, weekdays: [1] }]);
    expect(dias({ ...w, sessions: r.sessions })).toEqual([[1], []]);
    expect(r.diasOcupados).toBe(1);
  });

  it("recusa o mesmo dia em duas sessões, nomeando o dia", () => {
    const w = treino(sessao("Dia A"), sessao("Dia B"));
    expect(() =>
      aplicarAgenda(w, [
        { indice: 0, weekdays: [1] },
        { indice: 1, weekdays: [1] },
      ])
    ).toThrow(/Segunda/);
  });

  it("recusa quando o nome não bate — os índices deslizaram por outra tela", () => {
    const w = treino(sessao("Dia A"));
    expect(() => aplicarAgenda(w, [{ indice: 0, day: "Peito", weekdays: [1] }])).toThrow();
    expect(() => aplicarAgenda(w, [{ indice: 0, day: "dia a", weekdays: [1] }])).not.toThrow();
  });

  it("recusa índice fora da faixa", () => {
    expect(() => aplicarAgenda(treino(sessao("Dia A")), [{ indice: 7, weekdays: [1] }])).toThrow();
  });
});

describe("agendaPorDia", () => {
  it("põe a mesma sessão nos dois dias em que ela acontece", () => {
    // ABC em seis dias: A cai na segunda e na quinta. É o caso que obrigou
    // `weekdays` a ser array.
    const semana = agendaPorDia(treino(sessao("Dia A", [1, 4]), sessao("Dia B", [2])));
    expect(semana[1]?.day).toBe("Dia A");
    expect(semana[4]?.day).toBe("Dia A");
    expect(semana[2]?.day).toBe("Dia B");
    expect(semana[0]).toBeNull();
    expect(semana).toHaveLength(7);
  });

  it("devolve a semana vazia para plano sem agenda", () => {
    expect(agendaPorDia(treino(sessao("Dia A")))).toEqual(Array.from({ length: 7 }, () => null));
    expect(agendaPorDia(null)).toHaveLength(7);
  });
});

describe("sessoesSemDia", () => {
  it("conta só as que faltam", () => {
    expect(sessoesSemDia(treino(sessao("Dia A", [1]), sessao("Dia B"), sessao("Dia C", [])))).toBe(2);
    expect(sessoesSemDia(null)).toBe(0);
  });
});

describe("diaDaSemana", () => {
  it("usa o fuso de São Paulo, e não o UTC", () => {
    // 23h de SEGUNDA em São Paulo já é terça em UTC. Sem a conversão, quem
    // abrisse o app à noite veria o treino do dia seguinte.
    expect(diaDaSemana(new Date("2026-09-15T02:00:00Z"))).toBe(1);
    expect(diaDaSemana(new Date("2026-09-15T12:00:00Z"))).toBe(2);
  });

  it("dá 0 no domingo e 6 no sábado", () => {
    expect(diaDaSemana(new Date("2026-09-13T12:00:00Z"))).toBe(0);
    expect(diaDaSemana(new Date("2026-09-12T12:00:00Z"))).toBe(6);
  });
});
