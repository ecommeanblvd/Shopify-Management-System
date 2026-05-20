interface StoreSettings {
  storeName: string;
  shipping: unknown;
  checkoutStatus: 'available' | 'needs_migration';
}

export function SettingsViewer({ stores }: { stores: StoreSettings[] }) {
  return (
    <section style={{ padding: 24 }}>
      <h1>Settings Viewer</h1>
      {stores.length === 0 && <p>No stores connected yet.</p>}
      {stores.map((s) => (
        <article key={s.storeName} style={{ border: '1px solid #ddd', margin: '12px 0', padding: 12 }}>
          <h2>{s.storeName}</h2>
          <h3>Shipping</h3>
          <pre>{JSON.stringify(s.shipping, null, 2)}</pre>
          <h3>Checkout branding</h3>
          {s.checkoutStatus === 'available'
            ? <p>Checkout branding available.</p>
            : <p>Checkout branding unavailable — store needs migration to Checkout Extensibility.</p>}
        </article>
      ))}
    </section>
  );
}
