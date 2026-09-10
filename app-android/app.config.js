// Configuração do Expo em JS (e não app.json) para o nome do app vir da mesma
// constante que o resto do produto usa — ver src/marca.ts.
//
// O que continua fixo aqui, e por quê: `slug` amarra este projeto ao EAS,
// `scheme` amarra os links que já circularam, e `package`/`bundleIdentifier`
// definem a identidade da instalação. Trocar qualquer um faz quem já tem o app
// instalar um app separado, ou quebra o build.

const { MARCA } = require("./marca");

module.exports = {
  expo: {
    name: MARCA,
    slug: "fitsocial",
    version: "1.2.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
      infoPlist: {
        UIBackgroundModes: ["remote-notification"],
      },
      bundleIdentifier: "club.satriz.fitsocial",
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#0E1310",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      permissions: [
        "NOTIFICATIONS",
        "POST_NOTIFICATIONS",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ],
      package: "club.satriz.fitsocial",
      googleServicesFile: "./google-services.json",
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      // Pedido pelo proprio expo-sharing ao instalar: ele configura o
      // FileProvider do Android, sem o qual o arquivo nao chega ao Instagram.
      "expo-sharing",
      [
        "expo-location",
        {
          locationWhenInUsePermission: `O ${MARCA} usa sua localização para gravar o percurso do seu treino.`,
        },
      ],
      [
        "expo-notifications",
        {
          color: "#C8FA4B",
          icon: "./assets/android-icon-monochrome.png",
        },
      ],
    ],
    scheme: "fitsocial",
    extra: {
      eas: {
        projectId: "8e75a861-e9b1-413d-bf6a-512a058b041d",
      },
    },
    owner: "audazzz",
  },
};
