import { describe, it, expect } from 'vitest';
import { parseShopifyGraphql } from './parse-graphql';

const dom = 'shop.myshopify.com';

describe('parseShopifyGraphql', () => {
  it('parses a valid JSON GraphQL body', async () => {
    const res = new Response(JSON.stringify({ data: { shop: { name: 'X' } } }), { status: 200 });
    const out = await parseShopifyGraphql(res, dom);
    expect((out.data as { shop: { name: string } }).shop.name).toBe('X');
  });

  it('passes through a GraphQL errors field on a 200', async () => {
    const res = new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 });
    const out = await parseShopifyGraphql(res, dom);
    expect(out.errors).toBeTruthy();
  });

  // Đây là root cause của lỗi "Unexpected end of JSON input": body rỗng.
  it('throws a CLEAR error (not bare SyntaxError) on an empty body', async () => {
    const res = new Response('', { status: 200 });
    await expect(parseShopifyGraphql(res, dom)).rejects.toThrow(/Shopify GraphQL/i);
  });

  it('throws including HTTP status on a 5xx HTML body (matchable by retry: 502/gateway)', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(parseShopifyGraphql(res, dom)).rejects.toThrow(/502/);
  });

  it('throws a clear error on a 200 with non-JSON body', async () => {
    const res = new Response('not json at all', { status: 200 });
    await expect(parseShopifyGraphql(res, dom)).rejects.toThrow(/non-JSON|Shopify GraphQL/i);
  });
});
