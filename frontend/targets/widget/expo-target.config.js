/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "widget",
  displayName: "Bakers",
  // Écran verrouillé (accessoryRectangular/accessoryInline) et Live Activity
  // (ActivityKit) exigent 16.1 au minimum ; l'extension peut avoir une cible
  // de déploiement différente de l'app principale sans y toucher.
  deploymentTarget: "16.1",
  frameworks: ["SwiftUI", "WidgetKit"],
  colors: {
    // Couleur de marque (theme.color.brand dans l'app) utilisée comme accent
    // système du widget — la seule teinte fixe, le reste passe par les
    // couleurs dynamiques iOS pour s'adapter automatiquement au mode sombre.
    $accent: "#C05A35",
  },
  entitlements: {
    // Même App Group que l'app principale (déclaré une fois dans app.json).
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
