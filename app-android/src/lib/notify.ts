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
  confirmText = "OK"
): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancelar", style: "cancel" },
    { text: confirmText, onPress: onConfirm },
  ]);
}
