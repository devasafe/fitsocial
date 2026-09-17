# Metadado por metade do plano — desenho

**Data:** 17/09/2026

## O problema, em uma frase

O `Plan` tem **duas metades independentes** (`workout` e `diet`) e guarda **um** `createdBy`, **um**
`createdAt` e **um** `disclaimer` para as duas. Toda vez que alguém precisa saber algo sobre
**uma** das metades, a resposta vem do documento inteiro — e mente.

## Os cinco sintomas, todos encontrados entre 15 e 17/09/2026

1. **A autoria da dieta apontava para quem prescreveu treino.** O treinador prescreve na quarta,
   o que cria uma versão nova copiando a dieta, e o painel passava a dizer que a dieta era dele.
   *Remendado* em `services/autoriaDaDieta.ts`, que caminha o histórico comparando conteúdo.
2. **A edição in place deixa a autoria mentindo.** `PUT /plans/current` e `POST /plans/diet`
   editam a dieta na **mesma versão**, sem tocar em `createdBy`/`createdAt`. O aluno dispensa o
   nutri A, edita a dieta, contrata o B — e o B lê "prescrita por A" sobre uma dieta que o aluno
   mudou. *Não remendado.*
3. **Represcrição idêntica é indistinguível de cópia.** O nutri B reenvia a dieta de A sem mudar
   nada: o app avisa "B atualizou a sua dieta" e o painel atribui a A. Duas telas se contradizem.
   *Não remendado — e o remendo foi descartado de propósito:* a heurística que resolvia esse caso
   quebrava simetricamente quando o treinador reenvia um treino idêntico.
4. **O aviso legal mente.** A dieta que a nutricionista escreveu à mão sai com "gerado por IA —
   consulte um nutricionista", porque `disclaimer: atual?.disclaimer ?? DISCLAIMER_DO_NUTRI` quase
   nunca cai no `??`. *Não corrigido de propósito:* sobrescrever apagaria o aviso de dor que o
   treinador deixou na metade de treino. Entre aviso redundante e aviso apagado, ganhou o
   redundante.
5. **A autoria do TREINO se perde numa geração parcial.** Quando a IA gera só o treino e preserva
   a dieta do profissional, a versão nova fica assinada pela IA. *Mitigado* propagando o
   `createdBy` anterior quando alguma metade é preservada — o que **por outro lado** faz o campo
   dizer "do treinador" sobre um plano cuja dieta é da IA.

**Três remendos de leitura diferentes, uma causa só.** O sintoma 5 mostra o limite: mitigá-lo
piorou a precisão do campo, porque um campo só não consegue descrever duas metades.

## O desenho

`Plan` ganha metadado **por metade**, todos opcionais:

```ts
workoutCreatedBy?: ObjectId | null;   // quem escreveu o treino desta versão
workoutEm?: Date | null;              // quando
workoutDisclaimer?: string | null;    // o aviso daquela metade
dietCreatedBy?: ObjectId | null;
dietEm?: Date | null;
dietDisclaimer?: string | null;
```

**Sem backfill e sem migração.** Ausente significa **"não sei"**, que é a verdade para todo plano
que já existe — e é exatamente o que `createdBy: null` já significa hoje ("foi a IA, ou o próprio
aluno"). Os campos antigos **continuam existindo e sendo gravados**, porque o APK instalado os lê;
os novos são aditivos.

**Quem grava o quê:**

| Quem escreve | Grava na metade | Preserva a outra |
|---|---|---|
| `PUT /pro/alunos/:id/treino` | `workout*` = o coach, agora | copia `diet*` da versão anterior |
| `PUT /pro/alunos/:id/dieta` | `diet*` = o nutri, agora | copia `workout*` da anterior |
| `/plans/generate` e `/import` | as metades que **escreveu**: autor `null`, aviso da IA | copia o metadado da metade que **preservou** |
| `/plans/adjust` | idem | idem |
| `POST /plans/diet`, `PUT /plans/current` | `diet*`/`workout*` = o próprio aluno | a outra intocada |

**Leitura:** `GET /pro/alunos/:id/dieta` passa a devolver `dietCreatedBy`/`dietEm` diretamente.
`services/autoriaDaDieta.ts` **continua existindo** e continua sendo a resposta para todo plano
gravado antes desta tarefa — o gate é `dietEm != null`, e enquanto ele for ausente a autoria
vem da inferência, como sempre veio. (Uma versão anterior deste desenho dizia que o serviço
seria apagado; seria apagar a ponte para o passado junto com a dívida.)

**Quem escreveu não é profissional nenhum: o campo é `null`.** Vale para a IA e vale para o
próprio aluno editando à mão — `createdBy` responde "qual PROFISSIONAL escreveu isto", e nos
dois casos a resposta é "nenhum". Gravar ali o id do aluno faz o painel do nutricionista dizer
"prescrita por outro profissional", porque a tela só distingue três casos: nulo, eu, e outro.
Quem é o aluno já está no dono do plano.

**Os avisos:** `disclaimer` (documento) continua sendo gravado para o APK antigo, exatamente como
era antes desta tarefa — **não** foi implementada a escolha pela metade mais restritiva que uma
versão anterior deste desenho prometia. Os campos por metade são gravados e preservados, mas
ainda não são lidos por tela nenhuma. Escolher errado qual metade "vence" apagaria em silêncio
o aviso de dor que o treinador deixou, e isso é pior que um aviso redundante — a mesma razão
que já tinha decidido o sintoma 4. Fica para quando existir a tela que lê o aviso por metade.

## O que isto resolve, sintoma a sintoma

1. Direto: a autoria da dieta é `dietCreatedBy`.
2. A edição in place grava `dietCreatedBy` = o próprio aluno. Deixa de mentir.
3. Represcrição idêntica grava `dietCreatedBy` = B, `dietEm` = agora. Deixa de ser inferência.
4. Cada metade carrega o aviso dela; nenhum apaga o outro.
5. A geração parcial grava autor por metade; o `createdBy` do documento deixa de ter de servir a
   duas coisas.

## Fora deste desenho

- Backfill do histórico. Ausente é "não sei", e inventar autoria para o passado seria pior que
  não saber.
- Remover `createdBy`/`disclaimer` do documento. Eles ficam enquanto houver APK instalado que os
  leia.
- A tela do aluno mostrar os dois avisos separados — é outro desenho.
