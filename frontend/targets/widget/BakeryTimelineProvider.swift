import WidgetKit

struct BakeryEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct BakeryTimelineProvider: TimelineProvider {
    /// Contenu d'exemple affiché brièvement (et estompé par le système)
    /// avant que la vraie donnée ne charge — le mécanisme de "placeholder"
    /// standard de WidgetKit, jamais montré comme une donnée réelle.
    func placeholder(in context: Context) -> BakeryEntry {
        BakeryEntry(date: Date(), snapshot: WidgetSnapshot(
            logged_in: true, user_id: nil, date: nil, production_id: nil,
            items: [
                WidgetProductionItem(line_id: "1", recipe_title: "Baguettes", time: "08:00", quantity_label: "120 pièces", all_done: false),
                WidgetProductionItem(line_id: "2", recipe_title: "Croissants", time: "09:30", quantity_label: "80 pièces", all_done: false),
            ]
        ))
    }

    func getSnapshot(in context: Context, completion: @escaping (BakeryEntry) -> Void) {
        completion(BakeryEntry(date: Date(), snapshot: WidgetSnapshotStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BakeryEntry>) -> Void) {
        let entry = BakeryEntry(date: Date(), snapshot: WidgetSnapshotStore.read())

        // Politique de rafraîchissement : le plus tôt entre le prochain
        // minuit local (nouvelle journée de production, jamais l'ancienne
        // affichée par erreur) et une revérification périodique raisonnable
        // — jamais une boucle serrée ; iOS arbitre de toute façon la
        // fréquence réelle des recharges selon l'engagement utilisateur.
        let now = Date()
        let nextMidnight = Calendar.current.nextDate(
            after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(86400)
        let nextPeriodicCheck = now.addingTimeInterval(45 * 60)
        let reloadDate = min(nextMidnight, nextPeriodicCheck)

        completion(Timeline(entries: [entry], policy: .after(reloadDate)))
    }
}
