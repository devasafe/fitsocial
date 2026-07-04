import { Platform } from "react-native";

// No emulador Android, "localhost" aponta para o próprio emulador;
// o host da máquina é acessível via 10.0.2.2. No iOS/web, localhost serve.
// Em dispositivo físico, troque para o IP da sua máquina na rede local.
const LOCAL_API =
  Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? LOCAL_API;
