/**
 * Source for the Recently Viewed storefront embed bundle.
 *
 * Served from GET /api/storefront/recently-viewed/embed
 *
 * Self-contained vanilla JS. Boot order:
 *   1. inject scoped CSS
 *   2. if current page is a PDP, POST the view to the storefront API
 *   3. fetch the shopper's recent list
 *   4. render into every `<div data-recently-viewed></div>` host
 *
 * Public API on `window.__recentlyViewed`:
 *   list(), refresh(), clear()
 */

import { RECENTLY_VIEWED_CSS } from './styles';

export interface RecentlyViewedEmbedConfig {
  apiOrigin: string;
}

export function buildRecentlyViewedScript(
  config: RecentlyViewedEmbedConfig,
  options: { minify?: boolean } = {},
): string {
  const apiOrigin = JSON.stringify(config.apiOrigin);
  const cssLiteral = JSON.stringify(RECENTLY_VIEWED_CSS);
  const source = renderTemplate(apiOrigin, cssLiteral);
  return options.minify ? minifyRecentlyViewed(source) : source;
}

function renderTemplate(apiOrigin: string, cssLiteral: string): string {
  return `;(function() {
  'use strict';
  var API_ORIGIN = ${apiOrigin};
  var CSS = ${cssLiteral};
  var DEVICE_KEY = '__rv_device_id';
  var CLEAR_KEY = '__rv_cleared_at';

  function shopDomain() {
    if (window.Shopify && window.Shopify.shop) return window.Shopify.shop;
    var s = document.currentScript;
    if (s && s.getAttribute('data-shop')) return s.getAttribute('data-shop');
    return null;
  }
  var SHOP = shopDomain();

  function getDeviceId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (!v) {
        v = 'dev_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        localStorage.setItem(DEVICE_KEY, v);
      }
      return v;
    } catch (e) {
      return 'dev_session_' + Math.random().toString(36).slice(2, 12);
    }
  }

  function customerEmail() {
    if (window.__recentlyViewedCustomerEmail) return String(window.__recentlyViewedCustomerEmail);
    var meta = document.querySelector('meta[name="rv-customer-email"]');
    if (meta) return meta.getAttribute('content');
    return null;
  }

  function customerId() {
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
      return String(window.ShopifyAnalytics.meta.page.customerId);
    }
    return null;
  }

  function identity() {
    return {
      deviceId: getDeviceId(),
      email: customerEmail() || undefined,
      shopifyCustomerId: customerId() || undefined,
    };
  }

  function api(method, path, body) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var url = API_ORIGIN + '/api/storefront/recently-viewed' + path + sep + 'shop=' + encodeURIComponent(SHOP || '');
    return fetch(url, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    }).then(function(r) { return r.json().catch(function() { return null; }); });
  }

  function detectProduct() {
    var path = window.location.pathname || '';
    var m = path.match(/\\/products\\/([^\\/?#]+)/);
    if (!m) return null;
    var handle = m[1];

    var pid = null, title = null, image = null, price, currency = null, variantId = null;
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      var p = window.ShopifyAnalytics.meta.product;
      if (p.id) pid = String(p.id);
    }
    var form = document.querySelector('form[action^="/cart/add"], form[action*="/cart/add"], product-form form, [data-product-form] form');
    if (form) {
      var sel = form.querySelector('[name="id"]');
      if (sel && sel.value) variantId = String(sel.value);
    }
    var og = function(prop) {
      var el = document.querySelector('meta[property="' + prop + '"]');
      return el ? el.getAttribute('content') : null;
    };
    title = og('og:title') || (document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null);
    image = og('og:image');
    var priceStr = og('og:price:amount') || og('product:price:amount');
    if (priceStr) price = parseFloat(priceStr);
    currency = og('og:price:currency') || og('product:price:currency');

    if (!pid || !title) return null;
    return {
      shopifyProductId: pid,
      shopifyVariantId: variantId || undefined,
      productTitle: title,
      productHandle: handle,
      imageUrl: image || undefined,
      priceAmount: isFinite(price) ? price : undefined,
      priceCurrency: currency || undefined,
    };
  }

  function logCurrentPageView() {
    var snap = detectProduct();
    if (!snap) return;
    api('POST', '', { identity: identity(), snapshot: snap }).catch(function() {});
  }

  // ---- State ----
  var state = { items: [], loaded: false };

  function load() {
    var qs = 'deviceId=' + encodeURIComponent(getDeviceId());
    var em = customerEmail();
    if (em) qs += '&email=' + encodeURIComponent(em);
    return api('GET', '?' + qs).then(function(r) {
      state.items = (r && r.items) || [];
      state.loaded = true;
      renderAll();
    });
  }

  function clearLocal() {
    try { localStorage.setItem(CLEAR_KEY, String(Date.now())); } catch (e) {}
    state.items = [];
    renderAll();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatPrice(amount, currency) {
    if (amount == null || !isFinite(amount)) return '';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch (e) {
      return amount.toFixed(2) + (currency ? ' ' + currency : '');
    }
  }

  // Hide views that pre-date a local "clear" so the user sees an empty
  // list immediately even though the server still has the rows.
  function filterByClear(items) {
    var t = 0;
    try { t = Number(localStorage.getItem(CLEAR_KEY) || '0'); } catch (e) {}
    if (!t) return items;
    return items.filter(function(it) { return new Date(it.viewedAt).getTime() > t; });
  }

  function renderInto(host) {
    if (!host) return;
    var items = filterByClear(state.items);
    var currentPid = (detectProduct() || {}).shopifyProductId;
    if (currentPid) {
      // Don't show the product the shopper is already looking at.
      items = items.filter(function(it) { return it.shopifyProductId !== currentPid; });
    }
    if (!state.loaded) {
      host.innerHTML = '';
      return;
    }
    if (items.length === 0) {
      host.innerHTML = '<div class="rv-carousel"><p class="rv-empty">Nothing here yet.</p></div>';
      return;
    }
    var title = host.getAttribute('data-title') || 'Recently viewed';
    var html = '<div class="rv-carousel">' +
      '<div class="rv-carousel-head">' +
      '<h2 class="rv-title">' + escapeHtml(title) + '</h2>' +
      '<button class="rv-clear" type="button">Clear</button>' +
      '</div>' +
      '<div class="rv-track">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var thumb = it.imageUrl
        ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="" loading="lazy" />'
        : '<div class="rv-thumb-placeholder"></div>';
      html += '<article class="rv-card">' +
        '<a href="/products/' + escapeHtml(it.productHandle) + '">' +
        thumb +
        '<div class="rv-card-title">' + escapeHtml(it.productTitle) + '</div>' +
        (it.priceAmount ? '<div class="rv-card-price">' + escapeHtml(formatPrice(it.priceAmount, it.priceCurrency)) + '</div>' : '') +
        '</a></article>';
    }
    html += '</div></div>';
    host.innerHTML = html;
    var clear = host.querySelector('.rv-clear');
    if (clear) clear.addEventListener('click', clearLocal);
  }

  function renderAll() {
    var hosts = document.querySelectorAll('[data-recently-viewed]');
    for (var i = 0; i < hosts.length; i++) renderInto(hosts[i]);
  }

  function injectStyles() {
    if (document.querySelector('#rv-styles')) return;
    var s = document.createElement('style');
    s.id = 'rv-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function boot() {
    if (!SHOP) {
      console.warn('[recently-viewed] could not detect Shopify shop; widget disabled');
      return;
    }
    injectStyles();
    // Log the current PDP view first so the shopper's list includes it
    // immediately on the NEXT page. Don't block render on the response.
    logCurrentPageView();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__recentlyViewed = {
    list: function() { return state.items.slice(); },
    refresh: load,
    clear: clearLocal,
  };
})();
`;
}

/** Same minifier shape as the wishlist embed — strip comments first
 *  then protect string literals, so stray apostrophes inside `//`
 *  comments don't fool the placeholder pass. */
export function minifyRecentlyViewed(source: string): string {
  const decommented = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const protectedLiterals: string[] = [];
  const PROTECTED_TOKEN = ' RV_LIT_';
  const literalRe = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  const withPlaceholders = decommented.replace(literalRe, (m) => {
    const i = protectedLiterals.push(m) - 1;
    return `${PROTECTED_TOKEN}${i}__`;
  });
  const stripped = withPlaceholders
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
  return stripped.replace(
    new RegExp(`${PROTECTED_TOKEN}(\\d+)__`, 'g'),
    (_m, i) => protectedLiterals[Number(i)],
  );
}
