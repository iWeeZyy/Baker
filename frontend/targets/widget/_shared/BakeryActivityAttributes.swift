import ActivityKit
import Foundation

/// Partagé entre l'app principale (modules/bakers-live-activity, qui démarre/
/// termine l'activité) et l'extension widget (qui la présente sur l'écran
/// verrouillé et dans la Dynamic Island). Lié aux deux cibles via le dossier
/// `_shared` de `@bacons/apple-targets` — ne jamais dupliquer cette
/// définition ailleurs.
@available(iOS 16.1, *)
struct BakeryActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Le texte de l'étape en cours, tel qu'écrit dans la fiche production
        /// (jamais reformulé ni deviné).
        var stepText: String
        /// Absent quand l'étape n'a pas de durée connue — jamais une échéance inventée.
        var endAt: Date?
    }

    /// Le nom de la recette, fixe pour la durée de l'activité.
    var recipeTitle: String
}
