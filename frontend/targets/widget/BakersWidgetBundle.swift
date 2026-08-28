import ActivityKit
import SwiftUI
import WidgetKit

struct BakeryWidget: Widget {
    let kind: String = "BakeryProductionWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BakeryTimelineProvider()) { entry in
            BakeryWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Production du jour")
        .description("Consultez votre production du jour sans ouvrir l'application.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

/// Live Activity minimale : démarrée/mise à jour/terminée depuis
/// `modules/bakers-live-activity` quand une étape passe respectivement à
/// "en cours"/reste "en cours" avec une durée modifiée/"terminée" dans
/// `app/production/[id].tsx`. Entièrement locale — pas de jeton push, pas de
/// mise à jour en arrière-plan.
@available(iOS 16.1, *)
struct BakeryLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BakeryActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Label("Cuisson en cours", systemImage: "flame.fill")
                        .font(.caption.bold())
                        .foregroundStyle(.bakersBrand)
                    Spacer()
                    if let endAt = context.state.endAt {
                        Text(endAt, style: .timer)
                            .font(.caption.monospacedDigit())
                    }
                }
                Text(context.attributes.recipeTitle)
                    .font(.headline)
                Text(context.state.stepText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .padding()
            .activityBackgroundTint(Color(.systemBackground))
            .activitySystemActionForegroundColor(Color.bakersBrand)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.recipeTitle)
                        .font(.caption.bold())
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let endAt = context.state.endAt {
                        Text(endAt, style: .timer)
                            .font(.caption.monospacedDigit())
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.stepText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "flame.fill").foregroundStyle(.bakersBrand)
            } compactTrailing: {
                if let endAt = context.state.endAt {
                    Text(endAt, style: .timer).font(.caption2.monospacedDigit())
                } else {
                    Image(systemName: "flame.fill").foregroundStyle(.bakersBrand)
                }
            } minimal: {
                Image(systemName: "flame.fill").foregroundStyle(.bakersBrand)
            }
        }
    }
}

@main
struct BakersWidgetBundle: WidgetBundle {
    var body: some Widget {
        BakeryWidget()
        if #available(iOS 16.1, *) {
            BakeryLiveActivityWidget()
        }
    }
}
