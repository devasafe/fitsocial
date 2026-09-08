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
