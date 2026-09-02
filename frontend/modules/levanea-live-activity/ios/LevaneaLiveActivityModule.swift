import ExpoModulesCore
import ActivityKit

/// Pont natif minimal : démarre/actualise/termine la Live Activity "cuisson
/// en cours". `BakeryActivityAttributes` est défini une seule fois, dans
/// `targets/widget/_shared/`, et lié à la fois à l'app et à l'extension
/// widget par `@bacons/apple-targets` — jamais dupliqué ici.
///
/// Entièrement local : aucun jeton push, aucune mise à jour en arrière-plan.
/// L'activité vit tant que l'app reste ouverte sur l'étape en cours et se
/// termine explicitement, sur le même principe que les minuteurs de cuisson
/// (TimerContext.tsx), déjà 100% locaux.
public class LevaneaLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LevaneaLiveActivity")

        Function("start") { (recipeTitle: String, stepText: String, endAtIso: String?) in
            guard #available(iOS 16.1, *) else { return }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let endAt = endAtIso.flatMap { ISO8601DateFormatter().date(from: $0) }
            let attributes = BakeryActivityAttributes(recipeTitle: recipeTitle)
            let state = BakeryActivityAttributes.ContentState(stepText: stepText, endAt: endAt)
            Task {
                // Une seule cuisson affichée à la fois : referme toute activité
                // restée ouverte avant d'en démarrer une nouvelle.
                for activity in Activity<BakeryActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                do {
                    _ = try Activity<BakeryActivityAttributes>.request(
                        attributes: attributes,
                        content: .init(state: state, staleDate: nil)
                    )
                } catch {
                    // Silencieux, volontairement : une Live Activity qui échoue à
                    // démarrer ne doit jamais faire planter l'app ni bloquer la
                    // mise à jour du statut de l'étape.
                }
            }
        }

        Function("update") { (stepText: String, endAtIso: String?) in
            guard #available(iOS 16.1, *) else { return }
            let endAt = endAtIso.flatMap { ISO8601DateFormatter().date(from: $0) }
            Task {
                for activity in Activity<BakeryActivityAttributes>.activities {
                    await activity.update(.init(state: .init(stepText: stepText, endAt: endAt), staleDate: nil))
                }
            }
        }

        Function("end") { () in
            guard #available(iOS 16.1, *) else { return }
            Task {
                for activity in Activity<BakeryActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
    }
}
