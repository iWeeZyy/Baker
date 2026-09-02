import SwiftUI

extension Color {
    /// SwiftUI n'a pas d'initialiseur hex intégré ; sert uniquement à
    /// reproduire `theme.color.brand` (#C05A35) de l'app, la seule teinte
    /// fixe du widget — tout le reste (fond, texte) utilise les couleurs
    /// système dynamiques pour s'adapter automatiquement au mode sombre,
    /// qui n'existe pas dans l'app elle-même (palette unique dans theme.ts).
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "#" }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }

    static let brand = Color(hex: "#C05A35")
}
