import SwiftUI
import WidgetKit

/// URL de la fiche production correspondante, ou de la connexion si le
/// compte n'est pas connecté. Réutilise le routeur de l'app (Expo Router
/// mappe `levanea://production/{id}` sur `app/production/[id].tsx` et
/// `levanea://auth` sur `app/auth.tsx` sans configuration supplémentaire) —
/// jamais un système de navigation séparé, jamais une route "today"
/// symbolique qui n'existe pas.
private func productionURL(_ id: String) -> URL? { URL(string: "levanea://production/\(id)") }
private let authURL = URL(string: "levanea://auth")!

private func rowLabel(for item: WidgetProductionItem) -> some View {
    HStack(alignment: .top, spacing: 8) {
        if let time = item.time {
            Text(time)
                .font(.caption.monospacedDigit().bold())
                .foregroundStyle(.secondary)
                .frame(width: 40, alignment: .leading)
        }
        Text(item.recipe_title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(item.all_done ? .secondary : .primary)
            .strikethrough(item.all_done)
            .lineLimit(1)
        Spacer(minLength: 4)
        Text(item.quantity_label)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

private struct LoggedOutView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.title2)
                .foregroundStyle(.brand)
            Text("Connectez-vous pour afficher votre production")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
        .widgetURL(authURL)
    }
}

private struct NoProductionView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "moon.zzz")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Aucune production prévue aujourd'hui")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

private struct WidgetHeader: View {
    var body: some View {
        HStack(spacing: 4) {
            Text("🥖")
            Text("PRODUCTION")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.brand)
        }
    }
}

// MARK: - systemSmall

private struct SmallWidgetView: View {
    let items: [WidgetProductionItem]
    let productionId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            WidgetHeader()
            // Titre + quantité sur une ligne plutôt qu'une phrase fusionnée
            // ("120 baguettes") : composer une telle phrase demanderait de
            // deviner le pluriel français du nom de la recette, ce que rien
            // dans l'app ne fait ailleurs.
            ForEach(items.prefix(3), id: \.line_id) { item in
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.recipe_title)
                        .font(.caption2)
                        .foregroundStyle(item.all_done ? .secondary : .primary)
                        .strikethrough(item.all_done)
                        .lineLimit(1)
                    Text(item.quantity_label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding()
        .widgetURL(productionId.flatMap(productionURL))
    }
}

// MARK: - systemMedium

private struct MediumWidgetView: View {
    let items: [WidgetProductionItem]
    let productionId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetHeader()
            ForEach(items.prefix(4), id: \.line_id) { item in
                if let url = productionId.flatMap(productionURL) {
                    Link(destination: url) { rowLabel(for: item) }
                } else {
                    rowLabel(for: item)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding()
    }
}

// MARK: - systemLarge

private struct LargeWidgetView: View {
    let items: [WidgetProductionItem]
    let productionId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            WidgetHeader()
            ForEach(items, id: \.line_id) { item in
                if let url = productionId.flatMap(productionURL) {
                    Link(destination: url) { rowLabel(for: item) }
                } else {
                    rowLabel(for: item)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding()
    }
}

// MARK: - Écran verrouillé

private struct AccessoryRectangularWidgetView: View {
    let items: [WidgetProductionItem]

    var body: some View {
        if let first = items.first {
            VStack(alignment: .leading, spacing: 2) {
                Text("Prochaine production").font(.caption2)
                Text("\(first.time.map { "\($0) — " } ?? "")\(first.recipe_title)")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
            }
        } else {
            Text("Aucune production").font(.caption)
        }
    }
}

private struct AccessoryInlineWidgetView: View {
    let items: [WidgetProductionItem]

    var body: some View {
        if let first = items.first {
            Label("\(first.quantity_label) \(first.recipe_title)", systemImage: "birthday.cake")
        } else {
            Label("Aucune production", systemImage: "moon.zzz")
        }
    }
}

// MARK: - Fond de conteneur, compatible iOS 16 et 17+

private extension View {
    /// `containerBackground(for:)` n'existe qu'à partir d'iOS 17 ; en dessous,
    /// un `.background()` classique fait le même travail. Les familles
    /// d'écran verrouillé ne reçoivent aucun fond : le système fournit déjà
    /// le sien et le texte s'y adapte tout seul.
    @ViewBuilder
    func bakeryWidgetBackground(for family: WidgetFamily) -> some View {
        switch family {
        case .accessoryRectangular, .accessoryInline, .accessoryCircular:
            self
        default:
            if #available(iOS 17.0, *) {
                self.containerBackground(for: .widget) { Color(.systemBackground) }
            } else {
                self.background(Color(.systemBackground))
            }
        }
    }
}

// MARK: - Point d'entrée, par famille

struct BakeryWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: BakeryEntry

    var body: some View {
        content.bakeryWidgetBackground(for: family)
    }

    @ViewBuilder
    private var content: some View {
        let snapshot = entry.snapshot

        if snapshot == nil || snapshot?.logged_in == false {
            LoggedOutView()
        } else if let items = snapshot?.items, !items.isEmpty {
            switch family {
            case .systemSmall:
                SmallWidgetView(items: items, productionId: snapshot?.production_id)
            case .systemMedium:
                MediumWidgetView(items: items, productionId: snapshot?.production_id)
            case .accessoryRectangular:
                AccessoryRectangularWidgetView(items: items)
            case .accessoryInline:
                AccessoryInlineWidgetView(items: items)
            default:
                LargeWidgetView(items: items, productionId: snapshot?.production_id)
            }
        } else {
            switch family {
            case .accessoryRectangular:
                AccessoryRectangularWidgetView(items: [])
            case .accessoryInline:
                AccessoryInlineWidgetView(items: [])
            default:
                NoProductionView()
            }
        }
    }
}
