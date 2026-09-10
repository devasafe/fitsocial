import { describe, it, expect } from "vitest";
import {
  normalizarWod,
  fecharScore,
  repsPorRound,
  cargaEmKg,
  movimentosDoTreino,
  metconPrincipal,
  blocosDoTipo,
} from "./crossfit.js";
import { resolverBenchmark, buscarBenchmarks, getBenchmark } from "./benchmarks.js";
import type { WodPayloadV2 } from "../models/crossfit.js";

describe("O formato antigo continua legível", () => {
  const antigo = {
    name: "Fran",
    scoreType: "for_time" as const,
    level: "rx" as const,
    resultTimeSec: 332,
    description: "primeira vez",
    strengthBlock: {
      variant: "musculacao" as const,
      exercises: [{ name: "Back Squat", sets: [{ type: "valida" as const, weightKg: 100, reps: 5, done: true }] }],
    },
    movements: [{ name: "Thruster", loadKg: 43, reps: 21 }],
  };

  it("vira blocos, com a força ANTES do metcon", () => {
    const wod = normalizarWod(antigo);

    // O `strengthBlock` era um campo especial porque faltava a lista. Virando
    // bloco, ele volta a ser o que sempre foi: a força que veio antes do WOD.
    expect(wod.blocos.map((b) => b.tipo)).toEqual(["forca", "metcon"]);
  });

  it("reconhece o benchmark pelo nome digitado", () => {
    const metcon = metconPrincipal(normalizarWod(antigo));
    expect(metcon?.benchmark?.slug).toBe("fran");
    expect(metcon?.benchmark?.familia).toBe("girl");
  });

  it("NÃO inventa benchmark para nome livre", () => {
    const metcon = metconPrincipal(normalizarWod({ ...antigo, name: "WOD do dia" }));
    // Senão todo "WOD do dia" viraria um recorde só, comparando treinos que não
    // têm nada a ver um com o outro.
    expect(metcon?.benchmark).toBeNull();
    expect(metcon?.nome).toBe("WOD do dia");
  });

  it("os quatro campos soltos de resultado viram um score com tipo", () => {
    expect(metconPrincipal(normalizarWod(antigo))?.resultado).toMatchObject({
      tipo: "tempo",
      tempoSec: 332,
    });

    const amrap = metconPrincipal(
      normalizarWod({ ...antigo, scoreType: "amrap", resultTimeSec: null, resultRounds: 7, resultReps: 12 })
    );
    expect(amrap?.resultado).toMatchObject({ tipo: "rounds_reps", rounds: 7, repsExtras: 12 });
  });

  it("chipper deixa de ser formato e vira for time", () => {
    const wod = normalizarWod({ ...antigo, scoreType: "chipper" });
    // O que define um chipper é a sequência de movimentos, que agora tem ordem
    // própria na prescrição — não um tipo de pontuação separado.
    expect(metconPrincipal(wod)?.formato).toBe("for_time");
  });

  it("não mexe no que já é do formato novo", () => {
    const v2: WodPayloadV2 = { v: 2, box: "CrossFit X", blocos: [{ tipo: "aquecimento", movimentos: [], duracaoSec: 300 }] };
    expect(normalizarWod(v2)).toBe(v2);
  });
});

describe("Score", () => {
  const movimentos = [
    { nome: "Pull Up", reps: 5 },
    { nome: "Push Up", reps: 10 },
    { nome: "Air Squat", reps: 15 },
  ];

  it("AMRAP vira total de reps, para 6+40 não perder de 7+0", () => {
    const a = fecharScore({ tipo: "rounds_reps", rounds: 7, repsExtras: 0 }, movimentos);
    const b = fecharScore({ tipo: "rounds_reps", rounds: 6, repsExtras: 40 }, movimentos);

    expect(a.valor).toBe(210); // 7 × 30
    expect(b.valor).toBe(220); // 6 × 30 + 40
    // Comparar só rounds diria que "a" ganhou. Fez menos trabalho.
    expect(b.valor! > a.valor!).toBe(true);
  });

  it("sem contagem de reps no round, o valor canônico não existe", () => {
    const comDistancia = [{ nome: "Run", distanciaM: 400 }, { nome: "Burpee", reps: 15 }];
    expect(repsPorRound(comDistancia)).toBeNull();

    const s = fecharScore({ tipo: "rounds_reps", rounds: 5, repsExtras: 3 }, comDistancia);
    // Inventar um número aqui seria pior que não ter: o gráfico mentiria.
    expect(s.valor).toBeNull();
    expect(s.rounds).toBe(5);
  });

  it("tempo é o único onde menor é melhor", () => {
    expect(fecharScore({ tipo: "tempo", tempoSec: 332 }).maiorMelhor).toBe(false);
    expect(fecharScore({ tipo: "reps", reps: 42 }).maiorMelhor).toBe(true);
    expect(fecharScore({ tipo: "carga", cargaKg: 110 }).maiorMelhor).toBe(true);
  });

  it("capado carrega o parcial, não um tempo", () => {
    const s = fecharScore({ tipo: "rounds_reps", rounds: 4, repsExtras: 12, capado: true }, movimentos);
    expect(s.capado).toBe(true);
    expect(s.tempoSec).toBeUndefined();
  });
});

describe("Carga", () => {
  it("converte libra para quilo", () => {
    expect(cargaEmKg({ valor: 95, unidade: "lb" })).toBe(43.1);
  });

  it("não inventa quilo para o que não converte", () => {
    // 50% do 1RM depende do 1RM de quem treinou; corporal, do peso da pessoa.
    expect(cargaEmKg({ valor: 50, unidade: "percent_1rm" })).toBeNull();
    expect(cargaEmKg({ valor: 0, unidade: "corporal" })).toBeNull();
    expect(cargaEmKg(null)).toBeNull();
  });
});

describe("Movimentos do treino", () => {
  it("junta os movimentos de todos os blocos, normalizados e sem repetir", () => {
    const wod: WodPayloadV2 = {
      v: 2,
      blocos: [
        { tipo: "aquecimento", movimentos: [{ nome: "Air Squat" }], duracaoSec: 300 },
        { tipo: "skill", movimento: "Double Under" },
        { tipo: "forca", exercicios: [{ name: "Back Squat", sets: [{ type: "valida", weightKg: 100, reps: 5, done: true }] }] },
        {
          tipo: "metcon",
          formato: "for_time",
          prescricao: { movimentos: [{ nome: "Air Squat" }, { nome: "Pull-up" }] },
          escala: { nivel: "rx" },
        },
      ],
    };

    const movs = movimentosDoTreino(wod);
    // "Air Squat" aparece no aquecimento e no metcon — é um movimento só.
    expect(movs).toEqual(["air_squat", "double_under", "back_squat", "pull_up"]);
  });

  it("acha os blocos por tipo, na ordem", () => {
    const wod = normalizarWod({ name: "Grace", scoreType: "for_time", level: "rx", resultTimeSec: 200 });
    expect(blocosDoTipo(wod, "metcon")).toHaveLength(1);
    expect(blocosDoTipo(wod, "forca")).toHaveLength(0);
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
    expect(fran.movimentos[0].repScheme).toEqual([21, 15, 9]);
  });

  it("busca por parte do nome", () => {
    expect(buscarBenchmarks("fra").map((b) => b.slug)).toContain("fran");
    expect(buscarBenchmarks("mur").map((b) => b.slug)).toContain("murph");
  });
});
