export default function ConnectStorePage() {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Connect a Shopify Store</h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Enter your store domain to begin the installation flow.
      </p>
      <form method="GET" action="/api/auth/shopify/install">
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="shop" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            Store domain
          </label>
          <input
            id="shop"
            name="shop"
            type="text"
            required
            placeholder="your-shop.myshopify.com"
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: '1rem',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          type="submit"
          style={{
            padding: '0.5rem 1.25rem',
            background: '#5c6ac4',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Connect store
        </button>
      </form>
    </main>
  );
}
