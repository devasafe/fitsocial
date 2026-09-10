// A pergunta que aparece uma única vez, depois do primeiro treino salvo.
//
// Vive num provider no topo da árvore pelo mesmo motivo do PRCelebration: as
// telas de registro navegam logo depois de salvar, e a pergunta precisa
// sobreviver a isso. Também evita repetir o mesmo diálogo nas cinco telas de
// registro que existem.
//
// Regra que faz isso não virar fricção: o treino JÁ ESTÁ SALVO quando ela
// aparece. Fechar sem responder não perde nada — a pergunta volta no próximo
// treino, e a pessoa pode decidir em Configurações quando quiser.

import React, { createContext, useCallback, useContext, useState } from "react";
import { Modal, View } from "react-native";
import { Txt, Button } from "./ui";
import { useAuth } from "../context/AuthContext";
import { updateSettings } from "../api/settings";
import { colors, radius, spacing } from "../theme";

type PerguntarFn = () => void;

const Ctx = createContext<PerguntarFn>(() => {});

/** `const perguntarPrivacidade = usePerguntaDePrivacidade()` */
export function usePerguntaDePrivacidade(): PerguntarFn {
  return useContext(Ctx);
}

export function PrivacidadeTreinosProvider({ children }: { children: React.ReactNode }) {
  const { user, token, refreshUser } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const perguntar = useCallback(() => {
    // Só pergunta a quem ainda não respondeu. Respondeu uma vez, virou
    // configuração — e configuração não se pergunta de novo.
    if (user?.settings?.activitiesPublic == null) setAberto(true);
  }, [user]);

  async function responder(publico: boolean) {
    setSalvando(true);
    try {
      await updateSettings(token!, { activitiesPublic: publico });
      await refreshUser();
    } catch {
      // Falhou? A pergunta volta no próximo treino. Não vale travar a tela de
      // quem acabou de treinar por causa de uma preferência.
    } finally {
      setSalvando(false);
      setAberto(false);
    }
  }

  return (
    <Ctx.Provider value={perguntar}>
      {children}
      <Modal visible={aberto} transparent animationType="fade" onRequestClose={() => setAberto(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(8,11,9,0.72)", justifyContent: "center", padding: spacing.gutter }}>
          <View
            style={{
              backgroundColor: colors.surface2,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: radius.sheet,
              padding: spacing.lg,
            }}
          >
            <Txt variant="titleCard">Treino registrado 💪</Txt>

            <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.md }}>
              Quer que seus treinos apareçam no seu perfil? Outras pessoas vão poder ver o
              esporte, o tempo e o resultado.
            </Txt>
            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
              O trajeto de GPS continua privado, e você muda isso quando quiser.
            </Txt>

            <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
              <Button
                title="Sim, mostrar meus treinos"
                onPress={() => responder(true)}
                loading={salvando}
                size="lg"
                glow
              />
              <Button
                title="Manter privado"
                variant="ghost"
                onPress={() => responder(false)}
                disabled={salvando}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}
