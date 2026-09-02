import Foundation

/// Miroir exact du type `WidgetSnapshot` de `frontend/src/widgetData.ts` —
/// la seule vérité sur la forme des données est ce fichier TypeScript ; ne
/// jamais faire diverger ce `Codable` sans le mettre à jour en même temps.
struct WidgetProductionItem: Codable {
    let line_id: String
    let recipe_title: String
    let time: String?
    let quantity_label: String
    let all_done: Bool
}

struct WidgetSnapshot: Codable {
    let logged_in: Bool
    let user_id: String?
    let date: String?
    let production_id: String?
    let items: [WidgetProductionItem]?
}

enum WidgetSnapshotStore {
    static let appGroup = "group.com.lucasmorey.levanea"
    static let key = "widgetData"

    /// Ne renvoie jamais d'erreur : une donnée absente ou corrompue donne
    /// simplement `nil`, jamais un crash du widget.
    static func read() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
        // `ExtensionStorage.set()` côté JS écrit une chaîne pour une valeur
        // string (voir widgetData.ts : le snapshot est envoyé via
        // `JSON.stringify`, jamais un objet imbriqué) — donc lecture par
        // `string(forKey:)`, pas `data(forKey:)`.
        guard let raw = defaults.string(forKey: key), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
