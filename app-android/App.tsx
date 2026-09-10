import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from "@expo-google-fonts/archivo";
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold } from "@expo-google-fonts/sora";
import { AuthProvider } from "./src/context/AuthContext";
import { PRCelebrationProvider } from "./src/components/PRCelebration";
import { PrivacidadeTreinosProvider } from "./src/components/PrivacidadeTreinos";
import { ContadoresProvider } from "./src/context/ContadoresContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { colors } from "./src/theme";

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
  });

  // Splash calmo sobre bg enquanto as fontes carregam (sem spinner longo — brief §6.1).
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <ContadoresProvider>
          <PRCelebrationProvider>
            <PrivacidadeTreinosProvider>
              <RootNavigator />
            </PrivacidadeTreinosProvider>
          </PRCelebrationProvider>
        </ContadoresProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
