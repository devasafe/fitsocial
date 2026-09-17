import { Alert, Platform } from "react-native";

// Alert.alert não é implementado no react-native-web. Este helper usa window.alert
// no web (bloqueante — a ação roda depois) e Alert nativo no celular.
export function notify(title: string, message?: string, onOk?: () => void): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    onOk?.();
    return;
  }
  Alert.alert(title, message, onOk ? [{ text: "OK", onPress: onOk }] : undefined);
}

// Confirmação com ação. No web usa window.confirm; no nativo, Alert com botões.
export function confirmDialog(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmText = "OK",
  // Quem precisa SABER que a pessoa disse não — e não só deixar de agir — passa
  // isto. Sem ele, quem espera resposta dos dois lados (uma promessa, por
  // exemplo) fica pendurado para sempre no caminho do cancelar.
  onCancel?: () => void
): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      else onCancel?.();
    } else {
      onCancel?.();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancelar", style: "cancel", onPress: onCancel },
    { text: confirmText, onPress: onConfirm },
  ]);
}
