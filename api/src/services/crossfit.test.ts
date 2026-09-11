import { describe, it, expect } from "vitest";
import {
  fecharScore,
  repsPorRound,
  cargaEmKg,
  normalizarCarga,
  movimentosDoTreino,
  blocoPrincipal,
  volumeTotal,
  interpretarBlocos,
  normalizarWod,
} from "./crossfit.js";
import { resolverBenchmark, getBenchmark, buscarBenchmarks } from "./benchmarks.js";
import type { Bloco, Movimento, WodPayload } from "../models/crossfit.js";

/** Um movimento com o mínimo — o resto tem padrão. */
function mov(nome: string, extra: Partial<Movimento> = {}): Movimento {
  return {
    nome,
    volume: null,
    series: null,
    carga: null,
    altura: null,
    escopo: "individual",
    notas: null,
    ...extra,
  };
}

function bloco(modo: string, extra: Partial<Bloco> = {}): Bloco {
  return {
    modo,
    nome: null,
    benchmark: null,
    movimentos: [],
    lido: null,
    resultado: null,
    escala: { nivel: "rx" },
    rounds: null,
    notas: null,
    ...extra,
  };
}

function treino(blocos: Bloco[], extra: Partial<WodPayload> = {}): WodPayload {
  return {
    v: 3,
    nome: null,
    box: null,
    quadro: null,
    tamanhoDoTime: 1,
    parceiros: null,
    blocos,
    ...extra,
  };
}

const reps = (valor: number | number[]): Movimento["volume"] => ({ valor, unidade: "reps" });

describe("Score", () => {
  const cindy = [
    mov("Pull Up", { volume: reps(5) }),
    mov("Push Up", { volume: reps(10) }),
    mov("Air Squat", { volume: reps(15) }),
  ];

  it("AMRAP vira total de reps, para 6+40 não perder de 7+0", () => {
    const a = fecharScore({ tipo: "rounds_reps", rounds: 7, repsExtras: 0 }, cindy);
    const b = fecharScore({ tipo: "rounds_reps", rounds: 6, repsExtras: 40 }, cindy);

    expect(a.valor).toBe(210); // 7 × 30
    expect(b.valor).toBe(220); // 6 × 30 + 40
    // Comparar só rounds diria que "a" ganhou. Fez menos trabalho.
    expect(b.valor! > a.valor!).toBe(true);
  });

  it("sem contagem de reps no round, o valor canônico não existe", () => {
    const comDistancia = [
      mov("Run", { volume: { valor: 400, unidade: "metros" } }),
      mov("Burpee", { volume: reps(15) }),
    ];
    expect(repsPorRound(comDistancia)).toBeNull();

    const s = fecharScore({ tipo: "rounds_reps", rounds: 5, repsExtras: 3 }, comDistancia);
    // Inventar um número aqui seria pior que não ter: o gráfico mentiria.
    expect(s.valor).toBeNull();
    expect(s.rounds).toBe(5);
  });

  it("escada não tem round fixo, então não tem valor canônico", () => {
    // 21-15-9 são três rounds DIFERENTES; somar daria um round médio que
    // ninguém fez.
    const fran = [mov("Thruster", { volume: reps([21, 15, 9]) })];
    expect(repsPorRound(fran)).toBeNull();
  });

  it("tempo é o único onde menor é melhor", () => {
    expect(fecharScore({ tipo: "tempo", tempoSec: 332 }).maiorMelhor).toBe(false);
    expect(fecharScore({ tipo: "reps", reps: 42 }).maiorMelhor).toBe(true);
    expect(fecharScore({ tipo: "carga", cargaKg: 110 }).maiorMelhor).toBe(true);
  });

  it("capado carrega o parcial, não um tempo", () => {
    const s = fecharScore(
      { tipo: "rounds_reps", rounds: 4, repsExtras: 12, capado: true },
      cindy
    );
    expect(s.capado).toBe(true);
    expect(s.tempoSec).toBeUndefined();
  });

  it("score customizado não tem valor comparável", () => {
    // "soma do pior round" só significa algo para quem escreveu.
    const s = fecharScore({ tipo: "customizado", reps: 40, descricao: "soma do pior round" });
    expect(s.valor).toBeNull();
  });
});

describe("Carga", () => {
  it("converte libra para quilo", () => {
    expect(cargaEmKg({ rx: 95, unidade: "lb" })).toBe(43.1);
  });

  it("as duas prescrições do quadro convertem juntas", () => {
    // "95/65 lb" no quadro: as duas viram quilo, senão só uma categoria
    // conseguiria comparar recorde.
    const c = normalizarCarga({ rx: 95, rxF: 65, unidade: "lb" })!;
    expect(c.rxKg).toBe(43.1);
    expect(c.rxFKg).toBe(29.5);
  });

  it("não inventa quilo para o que não converte", () => {
    // 50% do 1RM depende do 1RM de quem treinou; corporal, do peso da pessoa.
    expect(cargaEmKg({ rx: 50, unidade: "percent_1rm" })).toBeNull();
    expect(cargaEmKg({ rx: 0, unidade: "corporal" })).toBeNull();
    expect(cargaEmKg(null)).toBeNull();
  });
});

describe("Volume e escopo do time", () => {
  it("individual multiplica pelo time; dividido e junto, não", () => {
    const m = (escopo: Movimento["escopo"]) => mov("Burpee", { volume: reps(40), escopo });

    // Cada um faz 40: o time fez 80.
    expect(volumeTotal(m("individual"), 2)).toBe(80);
    // "cada" é a mesma conta, dita explicitamente pelo quadro.
    expect(volumeTotal(m("cada"), 2)).toBe(80);
    // Relay: os 40 são repartidos entre os dois.
    expect(volumeTotal(m("dividido"), 2)).toBe(40);
    // Together: fizeram ao mesmo tempo, conta uma vez.
    expect(volumeTotal(m("junto"), 2)).toBe(40);
  });

  it("sozinho, o escopo não muda nada", () => {
    for (const escopo of ["individual", "dividido", "cada", "junto"] as const) {
      expect(volumeTotal(mov("Burpee", { volume: reps(40), escopo }), 1)).toBe(40);
    }
  });

  it("escada soma a escada inteira", () => {
    expect(volumeTotal(mov("Thruster", { volume: reps([21, 15, 9]) }))).toBe(45);
  });
});

describe("Movimentos do treino", () => {
  it("junta os movimentos de todos os blocos, normalizados e sem repetir", () => {
    const wod = treino([
      bloco("WARM-UP", { movimentos: [mov("Air Squat")] }),
      bloco("SKILL", { movimentos: [mov("Double Under")] }),
      bloco("FOR TIME", { movimentos: [mov("Air Squat"), mov("Pull-up")] }),
    ]);

    // "Air Squat" aparece no aquecimento e no WOD — é um movimento só.
    expect(movimentosDoTreino(wod)).toEqual(["air_squat", "double_under", "pull_up"]);
  });
});

describe("O bloco que representa o treino", () => {
  it("é o que TEM resultado, não o que tem rótulo", () => {
    // Antes a regra era "o primeiro metcon", e dependia de um tipo escolhido no
    // cadastro: quem registrasse o WOD como skill não tinha bloco principal.
    const wod = treino([
      bloco("WARM-UP", { movimentos: [mov("Air Squat")] }),
      bloco("SKILL / STRENGTH", { resultado: { tipo: "carga", cargaKg: 100 } }),
    ]);

    expect(blocoPrincipal(wod)?.modo).toBe("SKILL / STRENGTH");
  });

  it("sem resultado nenhum, cai no primeiro que não é descanso", () => {
    const wod = interpretarBlocos(
      treino([bloco("REST 1'"), bloco("AMRAP 8'", { movimentos: [mov("Burpee")] })])
    );
    expect(blocoPrincipal(wod)?.modo).toBe("AMRAP 8'");
  });
});

describe("Interpretação no salvamento", () => {
  it("preenche `lido` em todo bloco, a partir do modo", () => {
    const wod = interpretarBlocos(treino([bloco("AMRAP 6'"), bloco("REST 1'")]));

    expect(wod.blocos[0].lido?.familia).toBe("amrap");
    expect(wod.blocos[0].lido?.duracaoSec).toBe(360);
    expect(wod.blocos[1].lido?.familia).toBe("descanso");
  });

  it("rodar de novo não muda nada — `lido` é derivado, não acumulado", () => {
    const uma = interpretarBlocos(treino([bloco("EMOM (1'15\") x 4")]));
    const duas = interpretarBlocos(uma);
    expect(duas.blocos[0].lido).toEqual(uma.blocos[0].lido);
  });
});

describe("Payload inválido", () => {
  it("vira treino vazio, e nunca erro", () => {
    // Um payload estranho no banco não pode derrubar a leitura do histórico.
    expect(normalizarWod(null).blocos).toEqual([]);
    expect(normalizarWod({ lixo: true }).blocos).toEqual([]);
    expect(normalizarWod({ v: 3, blocos: [] }).tamanhoDoTime).toBe(1);
  });
});

describe("Catálogo de benchmarks", () => {
  it("casa nome digitado de qualquer jeito", () => {
    expect(resolverBenchmark("Fran")?.slug).toBe("fran");
    expect(resolverBenchmark("  fran ")?.slug).toBe("fran");
    expect(resolverBenchmark("FRAN")?.slug).toBe("fran");
    expect(resolverBenchmark("Fight Gone Bad")?.slug).toBe("fight_gone_bad");
  });

  it("recusa o que não é benchmark", () => {
    expect(resolverBenchmark("WOD de terça")).toBeUndefined();
    expect(resolverBenchmark("")).toBeUndefined();
    expect(resolverBenchmark(null)).toBeUndefined();
  });

  it("traz a prescrição pronta, para a tela preencher sozinha", () => {
    const fran = getBenchmark("fran")!;
    expect(fran.movimentos.map((m) => m.nome)).toEqual(["Thruster", "Pull Up"]);
    expect(fran.movimentos[0].volume).toEqual({ valor: [21, 15, 9], unidade: "reps" });
    expect(fran.movimentos[0].carga?.rx).toBe(43);
  });

  it("busca por parte do nome", () => {
    expect(buscarBenchmarks("fra").map((b) => b.slug)).toContain("fran");
    expect(buscarBenchmarks("mur").map((b) => b.slug)).toContain("murph");
  });
});
