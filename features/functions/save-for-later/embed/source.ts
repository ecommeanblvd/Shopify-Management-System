/**
 * Storefront embed for Save-for-later. Boot order:
 *   1. inject scoped CSS
 *   2. fetch current saved items
 *   3. if on /cart page:
 *      a. inject "Save for later" link next to each cart line
 *      b. render the saved panel after the cart form
 *   4. if any [data-save-for-later] host exists elsewhere, render too
 *
 * "Move back to cart" uses Shopify's standard Cart Ajax API
 * (/cart/add.js) — no operator config needed beyond the script tag.
 *
 * Public API on `window.__saveForLater`:
 *   list(), refresh(), save(snapshot), removeSaved(itemId), restore(itemId)
 */

import { SAVE_FOR_LATER_CSS } from './styles';

export interface SaveForLaterEmbedConfig {
  apiOrigin: string;
}

export function buildSaveForLaterScript(
  config: SaveForLaterEmbedConfig,
  options: { minify?: boolean } = {},
): string {
  const apiOrigin = JSON.stringify(config.apiOrigin);
  const cssLiteral = JSON.stringify(SAVE_FOR_LATER_CSS);
  const source = renderTemplate(apiOrigin, cssLiteral);
  return options.minify ? minifySaveForLater(source) : source;
}

function renderTemplate(apiOrigin: string, cssLiteral: string): string {
  return `;(function() {
  'use strict';
  var API_ORIGIN = ${apiOrigin};
  var CSS = ${cssLiteral};
  var DEVICE_KEY = '__sfl_device_id';

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
    if (window.__sflCustomerEmail) return String(window.__sflCustomerEmail);
    var meta = document.querySelector('meta[name="sfl-customer-email"]');
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
    var url = API_ORIGIN + '/api/storefront/save-for-later' + path + sep + 'shop=' + encodeURIComponent(SHOP || '');
    return fetch(url, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    }).then(function(r) { return r.json().catch(function() { return null; }); });
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

  // ---- Cart context helpers ----
  function isCartPage() {
    return /^\\/cart\\b/.test(window.location.pathname || '');
  }

  function findCartLines() {
    // Themes vary. Try the common shapes (data attribute first, then
    // class fallback). Filter to lines that carry a variant id.
    var nodes = document.querySelectorAll(
      '[data-cart-line], [data-cart-item], .cart__row, .cart-item, tr[data-line-id]'
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var variantId = node.getAttribute('data-variant-id') ||
        node.getAttribute('data-variant') ||
        node.getAttribute('data-id') ||
        readVariantFromInput(node);
      if (variantId) out.push({ node: node, variantId: String(variantId) });
    }
    return out;
  }

  function readVariantFromInput(node) {
    var input = node.querySelector('input[name="updates[]"], input[name^="updates"], a[href*="cart/change"]');
    if (input && input.value) return input.value;
    return null;
  }

  function detectLineSnapshot(line) {
    var img = line.node.querySelector('img');
    var titleEl = line.node.querySelector('a[href*="/products/"], .cart-item__name, .cart__product-title');
    var handle = null, productTitle = null, imageUrl = null;
    if (titleEl) {
      productTitle = (titleEl.textContent || '').trim();
      var href = titleEl.getAttribute && titleEl.getAttribute('href');
      var m = href && href.match(/\\/products\\/([^\\/?#]+)/);
      if (m) handle = m[1];
    }
    if (img) imageUrl = img.getAttribute('src');
    var qtyInput = line.node.querySelector('input[name^="updates"], input[name="quantity"]');
    var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value || '1', 10)) : 1;
    return {
      shopifyVariantId: line.variantId,
      productTitle: productTitle || 'Item',
      productHandle: handle || 'unknown',
      imageUrl: imageUrl || undefined,
      qty: qty,
    };
  }

  // Probe cart.js for a product id we can attach to the row. The DOM
  // rarely surfaces it directly, so we fall back to /cart.js on demand.
  var cartCache = null;
  function loadCartJson() {
    if (cartCache) return Promise.resolve(cartCache);
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(c) { cartCache = c; return c; })
      .catch(function() { return null; });
  }

  // ---- Save ----
  function saveLine(line) {
    var snap = detectLineSnapshot(line);
    return loadCartJson().then(function(cart) {
      if (cart && cart.items) {
        for (var i = 0; i < cart.items.length; i++) {
          if (String(cart.items[i].variant_id) === line.variantId) {
            var ci = cart.items[i];
            snap.shopifyProductId = String(ci.product_id);
            snap.productTitle = ci.product_title || ci.title || snap.productTitle;
            snap.productHandle = ci.handle || snap.productHandle;
            snap.imageUrl = ci.image || snap.imageUrl;
            snap.variantTitle = ci.variant_title || undefined;
            snap.priceAmount = (typeof ci.price === 'number') ? ci.price / 100 : undefined;
            snap.priceCurrency = (cart.currency || undefined);
            snap.qty = ci.quantity || snap.qty;
            break;
          }
        }
      }
      if (!snap.shopifyProductId) snap.shopifyProductId = 'variant_' + line.variantId;
      return api('POST', '', { identity: identity(), snapshot: snap });
    }).then(function(r) {
      if (!r || !r.id) { toast('Could not save item'); return null; }
      // Now remove from the cart via Shopify's /cart/change.js.
      return fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: line.variantId, quantity: 0 }),
      }).then(function() {
        toast('Saved for later');
        // Hard reload — themes vary too much to surgically update the cart DOM.
        window.location.reload();
      });
    });
  }

  // ---- Restore ----
  function restoreSaved(item) {
    var btn = document.querySelector('.sfl-btn-restore[data-id="' + item.id + '"]');
    if (btn) btn.disabled = true;
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        items: [{ id: Number(item.shopifyVariantId), quantity: item.qty || 1 }],
      }),
    }).then(function(r) {
      if (!r.ok) throw new Error('add failed');
      return removeSaved(item.id, /* silent */ true);
    }).then(function() {
      toast('Moved back to cart');
      window.location.reload();
    }).catch(function() {
      if (btn) btn.disabled = false;
      toast('Could not add to cart');
    });
  }

  function removeSaved(itemId, silent) {
    var qs = 'id=' + encodeURIComponent(itemId) +
             '&deviceId=' + encodeURIComponent(getDeviceId());
    return api('DELETE', '?' + qs).then(function() {
      state.items = state.items.filter(function(it) { return it.id !== itemId; });
      renderAll();
      if (!silent) toast('Removed');
    });
  }

  // ---- Rendering ----
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

  function renderInto(host) {
    if (!host) return;
    if (!state.loaded) return;
    if (state.items.length === 0) {
      host.innerHTML = '';
      return;
    }
    var title = host.getAttribute('data-title') || 'Saved for later';
    var html = '<div class="sfl-panel">' +
      '<div class="sfl-panel-head">' +
      '<h2 class="sfl-panel-title">' + escapeHtml(title) + '</h2>' +
      '<span class="sfl-panel-count">' + state.items.length + ' item' + (state.items.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="sfl-list">';
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      var thumb = it.imageUrl
        ? '<img class="sfl-item-thumb" src="' + escapeHtml(it.imageUrl) + '" alt="" loading="lazy" />'
        : '<div class="sfl-item-placeholder"></div>';
      var sub = '';
      if (it.variantTitle) sub += escapeHtml(it.variantTitle);
      if (it.priceAmount) {
        if (sub) sub += ' \\u00b7 ';
        sub += escapeHtml(formatPrice(it.priceAmount, it.priceCurrency));
      }
      if (it.qty > 1) {
        if (sub) sub += ' \\u00b7 ';
        sub += 'Qty ' + it.qty;
      }
      html += '<div class="sfl-item">' +
        thumb +
        '<div class="sfl-item-meta">' +
        '<div class="sfl-item-title"><a href="/products/' + escapeHtml(it.productHandle) + '" style="color:inherit;text-decoration:none">' +
        escapeHtml(it.productTitle) + '</a></div>' +
        (sub ? '<div class="sfl-item-sub">' + sub + '</div>' : '') +
        '</div>' +
        '<div class="sfl-item-actions">' +
        '<button class="sfl-btn-restore" type="button" data-id="' + escapeHtml(it.id) + '">Move to cart</button>' +
        '<button class="sfl-btn-remove" type="button" data-remove="' + escapeHtml(it.id) + '">Remove</button>' +
        '</div>' +
        '</div>';
    }
    html += '</div></div>';
    host.innerHTML = html;
    var restores = host.querySelectorAll('.sfl-btn-restore');
    for (var k = 0; k < restores.length; k++) {
      restores[k].addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        var item = state.items.filter(function(x) { return x.id === id; })[0];
        if (item) restoreSaved(item);
      });
    }
    var removes = host.querySelectorAll('.sfl-btn-remove');
    for (var m = 0; m < removes.length; m++) {
      removes[m].addEventListener('click', function() {
        removeSaved(this.getAttribute('data-remove'));
      });
    }
  }

  function renderCartPanel() {
    if (!isCartPage()) return;
    var host = document.querySelector('#sfl-cart-panel');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sfl-cart-panel';
      // Mount after the cart form when present; fall back to <main>.
      var anchor = document.querySelector('form[action="/cart"], form[action^="/cart"], main, body');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
      } else {
        document.body.appendChild(host);
      }
    }
    renderInto(host);
  }

  function mountCartLineActions() {
    if (!isCartPage()) return;
    var lines = findCartLines();
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].node.querySelector('.sfl-row-action')) continue;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sfl-row-action';
      btn.setAttribute('data-variant-id', lines[i].variantId);
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
        '<span>Save for later</span>';
      (function(l) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          saveLine(l);
        });
      })(lines[i]);
      // Append into the line's meta column if we can find one; else at the end.
      var slot = lines[i].node.querySelector('.cart-item__details, .cart-item__media, .cart__meta') || lines[i].node;
      slot.appendChild(btn);
    }
  }

  function renderAll() {
    renderCartPanel();
    var hosts = document.querySelectorAll('[data-save-for-later]');
    for (var i = 0; i < hosts.length; i++) renderInto(hosts[i]);
  }

  function toast(msg) {
    var prev = document.querySelector('.sfl-toast');
    if (prev) prev.remove();
    var t = document.createElement('div');
    t.className = 'sfl-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('sfl-toast--in'); });
    setTimeout(function() { t.classList.remove('sfl-toast--in'); }, 2200);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2500);
  }

  function injectStyles() {
    if (document.querySelector('#sfl-styles')) return;
    var s = document.createElement('style');
    s.id = 'sfl-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function boot() {
    if (!SHOP) {
      console.warn('[save-for-later] could not detect Shopify shop; widget disabled');
      return;
    }
    injectStyles();
    mountCartLineActions();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__saveForLater = {
    list: function() { return state.items.slice(); },
    refresh: load,
    save: function(snap) {
      return api('POST', '', { identity: identity(), snapshot: snap });
    },
    removeSaved: removeSaved,
    restore: function(itemId) {
      var item = state.items.filter(function(x) { return x.id === itemId; })[0];
      if (item) return restoreSaved(item);
    },
  };
})();
`;
}

/** Same minifier shape as the wishlist / recently-viewed / gift-registry embeds. */
export function minifySaveForLater(source: string): string {
  const decommented = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const protectedLiterals: string[] = [];
  const PROTECTED_TOKEN = ' SFL_LIT_';
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
