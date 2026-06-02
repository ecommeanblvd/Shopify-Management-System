/**
 * Storefront embed bundle for Gift Registry. Mounts an "Add to gift
 * registry" button on PDPs that opens a modal with three steps:
 *
 *   1. Email gate (remembered in localStorage after the first add).
 *   2. Pick a registry from the shopper's list, or "Create new".
 *   3. Choose qty + optional note, then submit.
 *
 * Public API on `window.__giftRegistry`:
 *   openPicker(), forgetEmail()
 */

import { GIFT_REGISTRY_EMBED_CSS } from './styles';

export interface GiftRegistryEmbedConfig {
  apiOrigin: string;
}

export function buildGiftRegistryScript(
  config: GiftRegistryEmbedConfig,
  options: { minify?: boolean } = {},
): string {
  const apiOrigin = JSON.stringify(config.apiOrigin);
  const cssLiteral = JSON.stringify(GIFT_REGISTRY_EMBED_CSS);
  const source = renderTemplate(apiOrigin, cssLiteral);
  return options.minify ? minifyGiftRegistry(source) : source;
}

function renderTemplate(apiOrigin: string, cssLiteral: string): string {
  return `;(function() {
  'use strict';
  var API_ORIGIN = ${apiOrigin};
  var CSS = ${cssLiteral};
  var EMAIL_KEY = '__gr_owner_email';

  function shopDomain() {
    if (window.Shopify && window.Shopify.shop) return window.Shopify.shop;
    var s = document.currentScript;
    if (s && s.getAttribute('data-shop')) return s.getAttribute('data-shop');
    return null;
  }
  var SHOP = shopDomain();

  function readEmail() {
    try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; }
  }
  function writeEmail(v) {
    try { localStorage.setItem(EMAIL_KEY, v); } catch (e) {}
  }
  function forgetEmail() {
    try { localStorage.removeItem(EMAIL_KEY); } catch (e) {}
  }

  function findCartForm() {
    return (
      document.querySelector('form[action^="/cart/add"]') ||
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector('product-form form') ||
      document.querySelector('[data-product-form] form') ||
      null
    );
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
    var form = findCartForm();
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- API ----
  function apiGet(path) {
    return fetch(API_ORIGIN + path, { credentials: 'omit' })
      .then(function(r) { return r.json().catch(function() { return null; }); });
  }
  function apiSend(method, path, body) {
    return fetch(API_ORIGIN + path, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    }).then(function(r) { return r.json().catch(function() { return null; }); });
  }

  function listMyRegistries(email) {
    return apiGet('/api/storefront/gift-registry/by-owner?shop=' + encodeURIComponent(SHOP || '') +
                  '&email=' + encodeURIComponent(email));
  }

  function createRegistry(input) {
    return apiSend('POST', '/api/storefront/gift-registry?shop=' + encodeURIComponent(SHOP || ''), input);
  }

  function addItem(token, ownerEmail, snapshot) {
    return apiSend('POST', '/api/storefront/gift-registry/' + encodeURIComponent(token) + '/items',
                   { ownerEmail: ownerEmail, snapshot: snapshot });
  }

  // ---- Toast ----
  function toast(msg) {
    var prev = document.querySelector('.gr-toast');
    if (prev) prev.remove();
    var t = document.createElement('div');
    t.className = 'gr-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('gr-toast--in'); });
    setTimeout(function() { t.classList.remove('gr-toast--in'); }, 2200);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2500);
  }

  // ---- Modal ----
  var modalRoot = null;
  var currentSnapshot = null;

  function mountModal() {
    if (modalRoot) return;
    modalRoot = document.createElement('div');
    modalRoot.className = 'gr-modal';
    modalRoot.hidden = true;
    modalRoot.innerHTML = '<div class="gr-modal-back"></div>' +
      '<div class="gr-modal-card" role="dialog" aria-label="Gift registry">' +
      '<div class="gr-modal-head">' +
      '<h2 class="gr-modal-title">Add to gift registry</h2>' +
      '<button class="gr-modal-close" type="button" aria-label="Close">\\u00D7</button>' +
      '</div>' +
      '<div class="gr-modal-body" data-region="body"></div>' +
      '</div>';
    document.body.appendChild(modalRoot);
    modalRoot.querySelector('.gr-modal-back').addEventListener('click', closeModal);
    modalRoot.querySelector('.gr-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  function openModal() {
    mountModal();
    currentSnapshot = detectProduct();
    if (!currentSnapshot) {
      toast('Could not detect this product');
      return;
    }
    modalRoot.hidden = false;
    requestAnimationFrame(function() { modalRoot.classList.add('gr-modal--open'); });
    if (readEmail()) {
      showPickStep(readEmail());
    } else {
      showEmailStep();
    }
  }

  function closeModal() {
    if (!modalRoot) return;
    modalRoot.classList.remove('gr-modal--open');
    setTimeout(function() { modalRoot.hidden = true; }, 220);
  }

  function setBody(html) {
    var body = modalRoot.querySelector('[data-region="body"]');
    if (body) body.innerHTML = html;
    return body;
  }

  // Step 1: email gate
  function showEmailStep() {
    var body = setBody(
      '<div class="gr-step">' +
      '<p style="font-size:13px;color:#555;margin:0 0 12px">Enter the email you use for your registry.</p>' +
      '<label class="gr-field">' +
      '<span class="gr-field-label">Email</span>' +
      '<input class="gr-input" data-gr="email" type="email" required placeholder="you@example.com" />' +
      '</label>' +
      '<div class="gr-actions">' +
      '<button class="gr-btn-primary" data-gr="continue" type="button">Continue</button>' +
      '</div>' +
      '<div class="gr-error" data-gr="error" hidden></div>' +
      '</div>'
    );
    var input = body.querySelector('[data-gr="email"]');
    var cont = body.querySelector('[data-gr="continue"]');
    cont.addEventListener('click', function() {
      var v = (input.value || '').trim().toLowerCase();
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)) {
        showError('Please enter a valid email');
        return;
      }
      writeEmail(v);
      showPickStep(v);
    });
    input.focus();
  }

  function showError(msg) {
    var el = modalRoot.querySelector('[data-gr="error"]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  // Step 2: pick a registry, or create new
  function showPickStep(email) {
    setBody('<p style="font-size:13px;color:#555;margin:0">Looking up your registries\\u2026</p>');
    listMyRegistries(email).then(function(r) {
      var list = (r && r.registries) || [];
      var html = '<div class="gr-step">' +
        '<p style="font-size:13px;color:#555;margin:0 0 6px">' +
        'Signed in as <strong>' + escapeHtml(email) + '</strong>' +
        ' <button class="gr-btn-link" data-gr="forget" type="button" style="display:inline">change</button>' +
        '</p>';
      if (list.length === 0) {
        html += '<p style="font-size:13px;color:#555;margin:0 0 12px">' +
          'No registries yet. Create one to add this product.</p>';
      } else {
        html += '<div class="gr-list">';
        for (var i = 0; i < list.length; i++) {
          var reg = list[i];
          var date = reg.eventDate ? formatShortDate(reg.eventDate) : '';
          html += '<button type="button" class="gr-list-item" data-token="' + escapeHtml(reg.shareToken) + '">' +
            '<span class="gr-list-item-meta">' +
            '<span class="gr-list-item-name">' + escapeHtml(reg.eventName) + '</span>' +
            (date ? '<span class="gr-list-item-sub">' + escapeHtml(date) + '</span>' : '') +
            '</span>' +
            '<span class="gr-list-item-count">' + reg.itemCount + ' item' + (reg.itemCount === 1 ? '' : 's') + '</span>' +
            '</button>';
        }
        html += '</div>';
      }
      html += '<div class="gr-actions">' +
        '<button class="gr-btn-primary" data-gr="create-new" type="button">Create new registry</button>' +
        '</div>' +
        '<div class="gr-error" data-gr="error" hidden></div>' +
        '</div>';
      var body = setBody(html);
      body.querySelector('[data-gr="forget"]').addEventListener('click', function() {
        forgetEmail();
        showEmailStep();
      });
      body.querySelector('[data-gr="create-new"]').addEventListener('click', function() {
        showCreateStep(email);
      });
      var picks = body.querySelectorAll('[data-token]');
      for (var k = 0; k < picks.length; k++) {
        picks[k].addEventListener('click', function() {
          var token = this.getAttribute('data-token');
          showAddStep(email, token);
        });
      }
    });
  }

  function formatShortDate(iso) {
    try {
      var d = new Date(iso + 'T00:00:00Z');
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    } catch (e) { return iso; }
  }

  // Step 2b: create new registry inline
  function showCreateStep(email) {
    setBody(
      '<div class="gr-step">' +
      '<label class="gr-field">' +
      '<span class="gr-field-label">Event name</span>' +
      '<input class="gr-input" data-gr="event-name" type="text" maxlength="200" required placeholder="Jane & John\\u2019s Wedding" />' +
      '</label>' +
      '<label class="gr-field">' +
      '<span class="gr-field-label">Event date (optional)</span>' +
      '<input class="gr-input" data-gr="event-date" type="date" />' +
      '</label>' +
      '<div class="gr-actions">' +
      '<button class="gr-btn-primary" data-gr="create" type="button">Create & add</button>' +
      '<button class="gr-btn-link" data-gr="back" type="button">Back</button>' +
      '</div>' +
      '<div class="gr-error" data-gr="error" hidden></div>' +
      '</div>'
    );
    var name = modalRoot.querySelector('[data-gr="event-name"]');
    var date = modalRoot.querySelector('[data-gr="event-date"]');
    modalRoot.querySelector('[data-gr="back"]').addEventListener('click', function() {
      showPickStep(email);
    });
    modalRoot.querySelector('[data-gr="create"]').addEventListener('click', function() {
      var eventName = (name.value || '').trim();
      if (!eventName) { showError('Event name is required'); return; }
      this.disabled = true;
      createRegistry({
        ownerEmail: email,
        eventName: eventName,
        eventDate: date.value || undefined,
      }).then(function(r) {
        if (!r || !r.shareToken) {
          showError((r && r.message) || 'Could not create registry');
          modalRoot.querySelector('[data-gr="create"]').disabled = false;
          return;
        }
        showAddStep(email, r.shareToken);
      });
    });
    name.focus();
  }

  // Step 3: qty + notes + submit
  function showAddStep(email, token) {
    if (!currentSnapshot) {
      toast('Lost product context — please reopen');
      closeModal();
      return;
    }
    setBody(
      '<div class="gr-step">' +
      '<p style="font-size:13px;color:#555;margin:0 0 8px">Adding to your registry:</p>' +
      '<p style="font-size:14px;font-weight:500;margin:0 0 14px">' + escapeHtml(currentSnapshot.productTitle) + '</p>' +
      '<div class="gr-row">' +
      '<label class="gr-field">' +
      '<span class="gr-field-label">How many?</span>' +
      '<input class="gr-input" data-gr="qty" type="number" min="1" max="99" value="1" />' +
      '</label>' +
      '</div>' +
      '<label class="gr-field">' +
      '<span class="gr-field-label">Note for guests (optional)</span>' +
      '<textarea class="gr-textarea" data-gr="notes" maxlength="500" placeholder="Size 9, rose gold"></textarea>' +
      '</label>' +
      '<div class="gr-actions">' +
      '<button class="gr-btn-primary" data-gr="add" type="button">Add to registry</button>' +
      '<button class="gr-btn-link" data-gr="back" type="button">Back</button>' +
      '</div>' +
      '<div class="gr-error" data-gr="error" hidden></div>' +
      '</div>'
    );
    var qtyInput = modalRoot.querySelector('[data-gr="qty"]');
    var notesInput = modalRoot.querySelector('[data-gr="notes"]');
    modalRoot.querySelector('[data-gr="back"]').addEventListener('click', function() {
      showPickStep(email);
    });
    modalRoot.querySelector('[data-gr="add"]').addEventListener('click', function() {
      var qty = Math.max(1, Math.min(99, Number(qtyInput.value || '1')));
      this.disabled = true;
      addItem(token, email, Object.assign({}, currentSnapshot, {
        qtyWanted: qty,
        notes: (notesInput.value || '').trim() || undefined,
      })).then(function(r) {
        if (!r || !r.itemId) {
          showError((r && r.message) || 'Could not add item');
          modalRoot.querySelector('[data-gr="add"]').disabled = false;
          return;
        }
        closeModal();
        toast('Added to your registry');
      });
    });
  }

  // ---- PDP button ----
  function mountPdpButton() {
    var snap = detectProduct();
    if (!snap) return;
    var form = findCartForm();
    if (!form || form.querySelector('.gr-pdp-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gr-pdp-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14M12 7c-1.5-3.5-6 0-3 3M12 7c1.5-3.5 6 0 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />' +
      '</svg><span>Add to gift registry</span>';
    btn.addEventListener('click', openModal);
    form.appendChild(btn);
  }

  // ---- Styles ----
  function injectStyles() {
    if (document.querySelector('#gr-styles')) return;
    var s = document.createElement('style');
    s.id = 'gr-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function boot() {
    if (!SHOP) {
      console.warn('[gift-registry] could not detect Shopify shop; widget disabled');
      return;
    }
    injectStyles();
    mountPdpButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__giftRegistry = {
    openPicker: openModal,
    forgetEmail: forgetEmail,
  };
})();
`;
}

/** Same minifier shape as the wishlist embed — strip comments first,
 *  then protect string literals. */
export function minifyGiftRegistry(source: string): string {
  const decommented = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const protectedLiterals: string[] = [];
  const PROTECTED_TOKEN = ' GR_LIT_';
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
