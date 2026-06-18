/**
 * Đọc + parse response của Shopify Admin GraphQL một cách AN TOÀN.
 *
 * Lý do: gọi thẳng `res.json()` sẽ ném `SyntaxError: Unexpected end of JSON
 * input` khi Shopify trả body RỖNG hoặc non-JSON (HTML 5xx/502 lúc tải nặng,
 * gateway timeout…). Lỗi đó cụt ngủn (chỉ "Unexpected end of JSON input") nên khi
 * bubble lên server-action thì người dùng chỉ thấy digest khó hiểu.
 *
 * Hàm này đọc text trước, rồi ném lỗi RÕ RÀNG kèm HTTP status + đoạn body — vừa
 * giúp debug, vừa khớp regex TRANSIENT (502/503/504/gateway) ở tầng retry của push.
 */
export async function parseShopifyGraphql(
  res: Response,
  shopDomain: string,
): Promise<{ data: unknown; errors?: unknown }> {
  const text = await res.text();
  const snippet = text.trim().slice(0, 300);

  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL HTTP ${res.status} (${shopDomain}): ${snippet || '<empty body>'}`,
    );
  }
  if (text.trim() === '') {
    throw new Error(`Shopify GraphQL empty response (HTTP ${res.status}, ${shopDomain})`);
  }
  try {
    return JSON.parse(text) as { data: unknown; errors?: unknown };
  } catch {
    throw new Error(
      `Shopify GraphQL non-JSON response (HTTP ${res.status}, ${shopDomain}): ${snippet}`,
    );
  }
}
