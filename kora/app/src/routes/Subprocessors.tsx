const PROCESSORS = [
  {
    name: 'Supabase (EU/Frankfurt project)',
    purpose: 'Datenbank, Authentifizierung, Backend-Funktionen',
    location: 'Europäische Union',
  },
  {
    name: 'Meta Platforms Ireland Ltd. (WhatsApp Business Cloud API)',
    purpose: 'Zustellung von WhatsApp-Benachrichtigungen (nur Text/Links, keine Dokumente)',
    location: 'EU/USA je nach Meta-Infrastruktur',
  },
  {
    name: 'Anthropic',
    purpose: 'KI-Textgenerierung für den KORA-Assistenten',
    location: 'USA',
  },
  {
    name: 'Vercel Inc.',
    purpose: 'Hosting der Weboberfläche',
    location: 'EU/USA je nach gewählter Region',
  },
]

export default function Subprocessors() {
  return (
    <div className="app-shell">
      <h1>
        Unterauftragsverarbeiter
        <span className="sub">Offenlegung gemäß Art. 13 Abs. 1 lit. e DSGVO.</span>
      </h1>
      <div className="card" style={{ marginTop: 20, maxWidth: 640 }}>
        <table>
          <thead>
            <tr>
              <th>Anbieter</th>
              <th>Zweck</th>
              <th>Standort</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.purpose}</td>
                <td>{p.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 16, maxWidth: 640 }}>
        KORA speichert keine Dokumente oder Bewacher-IDs im Text von WhatsApp-Nachrichten. Nachrichten
        enthalten höchstens einen Link zu Daten, die hinter Zugriffsschutz liegen.
      </p>
    </div>
  )
}
