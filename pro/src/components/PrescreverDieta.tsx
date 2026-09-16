import { useEffect, useState } from "react";
import { buscarDieta, prescreverDieta, ErroApi, type Dieta } from "../api";

/**
 * O formulário de prescrição de dieta.
 *
 * Diferente do treino (`Prescrever.tsx`, texto livre por linha), a dieta é
 * estruturada — o `dietSchema` do backend tem forma fixa (calorias, macros,
 * refeições com itens) — então o formulário espelha essa forma campo a campo,
 * em vez de pedir texto para interpretar.
 *
 * A diferença que mais importa: quando o aluno tem nutricionista, ele perde o
 * direito de editar a própria dieta (é a trava da Tarefa 5). Este formulário
 * vira então a ÚNICA porta pela qual a dieta daquela pessoa muda — por isso
 * ele carrega a dieta atual e pré-preenche tudo, inclusive `notes` (a
 * observação que o próprio aluno lê na tela dele): um campo esquecido aqui é
 * um campo que ninguém mais consegue preencher, e um valor sobrescrito é um
 * valor que ninguém mais recupera.
 */

interface ItemForm {
  food: string;
  quantity: string;
}

interface RefeicaoForm {
  name: string;
  timeHint: string;
  items: ItemForm[];
}

function refeicaoEmBranco(): RefeicaoForm {
  return { name: "", timeHint: "", items: [{ food: "", quantity: "" }] };
}

export function PrescreverDieta({
  token,
  alunoId,
  euId,
  aoSalvar,
}: {
  token: string;
  alunoId: string;
  /** Quem está logado — só para saber se a dieta atual é "sua" ou de outro profissional. */
  euId: string;
  aoSalvar: () => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const [existiaDieta, setExistiaDieta] = useState(false);
  const [origem, setOrigem] = useState<{ createdBy: string | null; em: string | null } | null>(null);

  const [dailyCalories, setDailyCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [meals, setMeals] = useState<RefeicaoForm[]>([refeicaoEmBranco()]);
  const [notes, setNotes] = useState("");
  const [resumo, setResumo] = useState("");
  const [recado, setRecado] = useState("");

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  // Carrega a dieta corrente e pré-preenche o formulário com ela: prescrever
  // quase sempre é ajustar a anterior, e obrigar a redigitar cinco refeições
  // é o caminho mais curto para o nutricionista não usar o painel.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    buscarDieta(token, alunoId)
      .then((r) => {
        if (!vivo) return;
        const { diet, createdBy, em } = r.data;
        setOrigem({ createdBy, em });
        setExistiaDieta(diet !== null);
        if (diet) {
          setDailyCalories(String(diet.dailyCalories));
          setProteinG(String(diet.macros.proteinG));
          setCarbsG(String(diet.macros.carbsG));
          setFatG(String(diet.macros.fatG));
          setMeals(
            diet.meals.length > 0
              ? diet.meals.map((m) => ({
                  name: m.name,
                  timeHint: m.timeHint ?? "",
                  items: m.items.map((it) => ({ food: it.food, quantity: it.quantity })),
                }))
              : [refeicaoEmBranco()]
          );
          setNotes(diet.notes ?? "");
        }
        setErroCarregar(null);
      })
      .catch((e) => {
        if (!vivo) return;
        setErroCarregar(e instanceof ErroApi ? e.message : "Não foi possível carregar a dieta atual.");
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, alunoId]);

  function mexeuNaDieta() {
    setSalvo(false);
  }

  function atualizarRefeicao(indice: number, patch: Partial<RefeicaoForm>) {
    mexeuNaDieta();
    setMeals((ms) => ms.map((m, i) => (i === indice ? { ...m, ...patch } : m)));
  }

  function adicionarRefeicao() {
    mexeuNaDieta();
    setMeals((ms) => [...ms, refeicaoEmBranco()]);
  }

  function removerRefeicao(indice: number) {
    mexeuNaDieta();
    setMeals((ms) => (ms.length > 1 ? ms.filter((_, i) => i !== indice) : ms));
  }

  function atualizarItem(indiceRefeicao: number, indiceItem: number, patch: Partial<ItemForm>) {
    mexeuNaDieta();
    setMeals((ms) =>
      ms.map((m, i) =>
        i === indiceRefeicao
          ? { ...m, items: m.items.map((it, j) => (j === indiceItem ? { ...it, ...patch } : it)) }
          : m
      )
    );
  }

  function adicionarItem(indiceRefeicao: number) {
    mexeuNaDieta();
    setMeals((ms) =>
      ms.map((m, i) => (i === indiceRefeicao ? { ...m, items: [...m.items, { food: "", quantity: "" }] } : m))
    );
  }

  function removerItem(indiceRefeicao: number, indiceItem: number) {
    mexeuNaDieta();
    setMeals((ms) =>
      ms.map((m, i) =>
        i === indiceRefeicao && m.items.length > 1
          ? { ...m, items: m.items.filter((_, j) => j !== indiceItem) }
          : m
      )
    );
  }

  async function salvar() {
    setErro(null);

    if (!dailyCalories.trim() || !proteinG.trim() || !carbsG.trim() || !fatG.trim()) {
      setErro("Preencha as calorias diárias e os três macros.");
      return;
    }
    const kcal = Number(dailyCalories);
    const proteina = Number(proteinG);
    const carbo = Number(carbsG);
    const gordura = Number(fatG);

    if (!Number.isInteger(kcal) || kcal < 800 || kcal > 6000) {
      setErro("As calorias diárias precisam ser um número inteiro entre 800 e 6000.");
      return;
    }
    if (![proteina, carbo, gordura].every((n) => Number.isInteger(n) && n >= 0)) {
      setErro("Proteína, carboidrato e gordura precisam ser números inteiros, 0 ou mais.");
      return;
    }
    if (meals.some((m) => !m.name.trim())) {
      setErro("Toda refeição precisa de um nome.");
      return;
    }
    const semItemCompleto = meals.find((m) => m.items.some((it) => !it.food.trim() || !it.quantity.trim()));
    if (semItemCompleto) {
      setErro(`Complete alimento e quantidade em todos os itens de "${semItemCompleto.name}".`);
      return;
    }
    if (!resumo.trim()) {
      setErro("Escreva um resumo da dieta.");
      return;
    }

    const diet: Dieta = {
      dailyCalories: kcal,
      macros: { proteinG: proteina, carbsG: carbo, fatG: gordura },
      meals: meals.map((m) => ({
        name: m.name.trim(),
        timeHint: m.timeHint.trim(),
        items: m.items.map((it) => ({ food: it.food.trim(), quantity: it.quantity.trim() })),
      })),
      notes: notes.trim(),
    };

    setSalvando(true);
    try {
      const r = await prescreverDieta(token, alunoId, resumo.trim(), diet, recado);
      setSalvo(true);
      setRecado("");
      // Sem isto, o cabeçalho continuava dizendo "prescrita por outro
      // profissional" (ou nem existia) depois de eu mesmo acabar de salvar —
      // `origem` só vinha do GET inicial, e o formulário não recarrega a
      // dieta sozinho. Atualizo com o que acabei de gravar, sem outra
      // viagem à rede: o servidor não devolve `createdAt` no PUT, mas "agora"
      // já é a data certa, e `existiaDieta` também precisa virar `true` para
      // quem prescrevia pela primeira vez.
      setOrigem({ createdBy: r.data.createdBy, em: new Date().toISOString() });
      setExistiaDieta(true);
      aoSalvar();
    } catch (e) {
      // Inclui o 403 "Só o nutricionista prescreve dieta." (e o de escopo
      // fechado): a aba só deveria aparecer para quem pode prescrever, mas se
      // acontecer mesmo assim é a mensagem do servidor que explica o motivo,
      // não uma genérica.
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar a dieta.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="vazio">Carregando dieta atual…</p>;
  if (erroCarregar) return <p className="erro">{erroCarregar}</p>;

  const dataOrigem = origem?.em ? new Date(origem.em).toLocaleDateString("pt-BR") : null;

  return (
    <div>
      {/* Quem escreveu a dieta que está na tela — para o nutricionista saber
          se está ajustando a própria prescrição ou a de outro profissional
          antes de sobrescrever.
          `createdBy` nulo não é raro nem transitório: é o estado de todo
          plano que já existe hoje (gerado por IA ou escrito pelo próprio
          aluno) e vai ser o estado de toda dieta que um nutricionista pegar
          pela primeira vez. Por isso tem frase própria, descrevendo o que
          houve sem inventar um autor — nunca "prescrita por —" nem em
          branco. */}
      <p className="sub" style={{ marginBottom: 16 }}>
        {!existiaDieta
          ? "Este aluno ainda não tem dieta registrada."
          : origem?.createdBy === null
            ? `Dieta atual sem prescrição de profissional — gerada por IA ou escrita pelo próprio aluno${dataOrigem ? ` · ${dataOrigem}` : ""}.`
            : origem?.createdBy === euId
              ? `Dieta atual prescrita por você${dataOrigem ? ` · ${dataOrigem}` : ""}.`
              : `Dieta atual prescrita por outro profissional${dataOrigem ? ` · ${dataOrigem}` : ""}.`}
      </p>

      <div className="campo">
        <label htmlFor="resumoDieta">Resumo da dieta</label>
        <input
          id="resumoDieta"
          value={resumo}
          onChange={(e) => setResumo(e.target.value)}
          placeholder="Reeducação alimentar, foco em proteína."
          maxLength={500}
        />
      </div>

      {/* Mesma lógica do recado de treino: a dieta nova chega ao aluno como
          mensagem, na conversa — isto aqui é o que o nutricionista diria por
          cima dela. */}
      <div className="campo">
        <label htmlFor="recadoDieta">Recado para o aluno (opcional)</label>
        <textarea
          id="recadoDieta"
          value={recado}
          onChange={(e) => setRecado(e.target.value)}
          placeholder="Troquei o lanche da tarde. Bebe mais água entre as refeições."
          maxLength={1000}
          rows={3}
          style={{ fontFamily: "var(--corpo)" }}
        />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="campo" style={{ flex: "1 1 160px" }}>
          <label htmlFor="kcal">Calorias diárias</label>
          <input
            id="kcal"
            type="number"
            min={800}
            max={6000}
            step={1}
            value={dailyCalories}
            onChange={(e) => {
              mexeuNaDieta();
              setDailyCalories(e.target.value);
            }}
            placeholder="2000"
          />
        </div>
        <div className="campo" style={{ flex: "1 1 120px" }}>
          <label htmlFor="proteina">Proteína (g)</label>
          <input
            id="proteina"
            type="number"
            min={0}
            step={1}
            value={proteinG}
            onChange={(e) => {
              mexeuNaDieta();
              setProteinG(e.target.value);
            }}
            placeholder="150"
          />
        </div>
        <div className="campo" style={{ flex: "1 1 120px" }}>
          <label htmlFor="carbo">Carboidrato (g)</label>
          <input
            id="carbo"
            type="number"
            min={0}
            step={1}
            value={carbsG}
            onChange={(e) => {
              mexeuNaDieta();
              setCarbsG(e.target.value);
            }}
            placeholder="220"
          />
        </div>
        <div className="campo" style={{ flex: "1 1 120px" }}>
          <label htmlFor="gordura">Gordura (g)</label>
          <input
            id="gordura"
            type="number"
            min={0}
            step={1}
            value={fatG}
            onChange={(e) => {
              mexeuNaDieta();
              setFatG(e.target.value);
            }}
            placeholder="60"
          />
        </div>
      </div>

      <div className="campo">
        <label>Refeições</label>
        {meals.map((refeicao, i) => (
          <div key={i} className="painel" style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="campo" style={{ flex: "1 1 200px", marginBottom: 0 }}>
                <label htmlFor={`nome-${i}`}>Nome</label>
                <input
                  id={`nome-${i}`}
                  value={refeicao.name}
                  onChange={(e) => atualizarRefeicao(i, { name: e.target.value })}
                  placeholder="Café da manhã"
                />
              </div>
              <div className="campo" style={{ flex: "1 1 140px", marginBottom: 0 }}>
                <label htmlFor={`horario-${i}`}>Horário sugerido (opcional)</label>
                <input
                  id={`horario-${i}`}
                  value={refeicao.timeHint}
                  onChange={(e) => atualizarRefeicao(i, { timeHint: e.target.value })}
                  placeholder="07:00, pós-treino…"
                />
              </div>
              <button
                className="discreto perigo"
                type="button"
                onClick={() => removerRefeicao(i)}
                disabled={meals.length === 1}
              >
                Remover refeição
              </button>
            </div>

            <div className="linhas" style={{ marginTop: 8 }}>
              {refeicao.items.map((item, j) => (
                <div key={j} className="linha" style={{ cursor: "default", gap: 8 }}>
                  <input
                    value={item.food}
                    onChange={(e) => atualizarItem(i, j, { food: e.target.value })}
                    placeholder="Ovo"
                    style={{ flex: "1 1 60%" }}
                  />
                  <input
                    value={item.quantity}
                    onChange={(e) => atualizarItem(i, j, { quantity: e.target.value })}
                    placeholder="100g, 1 unidade…"
                    style={{ flex: "1 1 30%" }}
                  />
                  <button
                    className="discreto perigo"
                    type="button"
                    onClick={() => removerItem(i, j)}
                    disabled={refeicao.items.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="discreto" type="button" style={{ marginTop: 8 }} onClick={() => adicionarItem(i)}>
              + Item
            </button>
          </div>
        ))}
        <button className="discreto" type="button" style={{ marginTop: 8 }} onClick={adicionarRefeicao}>
          + Refeição
        </button>
      </div>

      {/* Isto é o campo que some da lista principal do brief mas não pode
          sumir do formulário: `notes` vive dentro da dieta e o ALUNO lê na
          tela dele (app-android/src/screens/DietScreen.tsx). Não é o recado
          acima — o recado é o que o nutricionista diz agora, isto fica junto
          da dieta até a próxima prescrição. */}
      <div className="campo">
        <label htmlFor="notasDieta">Observações (o aluno vê na dieta dele)</label>
        <textarea
          id="notasDieta"
          value={notes}
          onChange={(e) => {
            mexeuNaDieta();
            setNotes(e.target.value);
          }}
          placeholder="Beber pelo menos 2 litros de água por dia."
          rows={2}
          style={{ fontFamily: "var(--corpo)" }}
        />
      </div>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      {salvo && <p style={{ color: "var(--verde-claro)" }}>Dieta enviada para o aluno.</p>}

      <button className="primario" onClick={salvar} disabled={salvando}>
        {salvando ? "Enviando…" : "Enviar dieta"}
      </button>
    </div>
  );
}
