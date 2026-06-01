/**
 * Source for the storefront wishlist embed bundle.
 *
 * Returned to the storefront as plain JS from
 *   GET /api/storefront/wishlist/embed
 *
 * Self-contained vanilla JS — no React, no bundler, no transpile step.
 * Targets every browser Shopify themes ship to (so ES5-ish: var, no
 * arrow functions, no optional chaining, no template literals).
 *
 * Boot order:
 *   1. inject scoped CSS
 *   2. mount drawer skeleton
 *   3. try to auto-mount PDP heart button
 *   4. try to inline-render into `<div id="wishlist-page"></div>` if found
 *   5. wire `[data-wishlist-trigger]` click handlers
 *   6. fetch the current wishlist, then re-render
 *   7. if a customer email becomes visible, call /merge once
 *
 * Public API on `window.__wishlist`:
 *   open(), close(), add(snapshot), remove(productId, variantId?), state(), reload()
 */

import { WISHLIST_EMBED_CSS } from './styles';

export interface EmbedConfig {
  /** Origin of this app, e.g. https://shopify-mgmt.vercel.app */
  apiOrigin: string;
}

/** Builds the JS source served at GET /api/storefront/wishlist/embed. */
export function buildEmbedScript(config: EmbedConfig): string {
  const apiOrigin = JSON.stringify(config.apiOrigin);
  const cssLiteral = JSON.stringify(WISHLIST_EMBED_CSS);
  return `;(function() {
  'use strict';
  var API_ORIGIN = ${apiOrigin};
  var CSS = ${cssLiteral};
  var DEVICE_KEY = '__wl_device_id';
  var MERGE_KEY = '__wl_merged_to';

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
    // Themes vary. Try the common surfaces.
    if (window.__wishlistCustomerEmail) return String(window.__wishlistCustomerEmail);
    var meta = document.querySelector('meta[name="wishlist-customer-email"]');
    if (meta) return meta.getAttribute('content');
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.lib && window.ShopifyAnalytics.lib.user) {
      try {
        var traits = window.ShopifyAnalytics.lib.user().traits();
        if (traits && traits.email) return String(traits.email);
      } catch (e) {}
    }
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
      email: customerEmail() || undefined,
      deviceId: getDeviceId(),
      shopifyCustomerId: customerId() || undefined,
    };
  }

  // ---- Tiny fetch wrapper. Errors are surfaced via console + ignored at UI. ----
  function api(path, opts) {
    opts = opts || {};
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var url = API_ORIGIN + '/api/storefront/wishlist' + path + sep + 'shop=' + encodeURIComponent(SHOP || '');
    return fetch(url, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
    }).then(function(r) { return r.json().catch(function() { return null; }); });
  }

  // ---- State ----
  // config is the resolved per-store config from the boot response.
  // Defaults match DEFAULT_WISHLIST_CONFIG in features/functions/wishlist/config.ts
  // (kept in sync via embed source tests).
  var DEFAULT_CONFIG = {
    accentColor: '#e11d48',
    buttonLabel: { unsaved: 'Add to wishlist', saved: 'Saved to wishlist' },
    buttonPosition: 'append',
    emailCapture: {
      enabled: true,
      headline: 'Save your wishlist across devices',
      cta: 'Save list',
    },
  };
  var state = { items: [], wishlist: null, loaded: false, config: DEFAULT_CONFIG };
  var listeners = [];

  function applyConfigSideEffects() {
    // Accent → CSS variable. Theme can still override at the :root level.
    try {
      var accent = (state.config && state.config.accentColor) || DEFAULT_CONFIG.accentColor;
      document.documentElement.style.setProperty('--wl-accent', accent);
    } catch (e) {}
  }

  function setState(patch) {
    for (var k in patch) state[k] = patch[k];
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }

  // ---- Identity-keyed wishlist read ----
  function buildIdentityQS() {
    var id = identity();
    var parts = [];
    if (id.email) parts.push('email=' + encodeURIComponent(id.email));
    if (id.deviceId) parts.push('deviceId=' + encodeURIComponent(id.deviceId));
    if (id.shopifyCustomerId) parts.push('shopifyCustomerId=' + encodeURIComponent(id.shopifyCustomerId));
    return parts.join('&');
  }

  function load() {
    return api('?' + buildIdentityQS()).then(function(r) {
      if (!r) return;
      setState({
        items: r.items || [],
        wishlist: r.wishlist || null,
        loaded: true,
        config: r.config || DEFAULT_CONFIG,
      });
      applyConfigSideEffects();
      renderAll();
    });
  }

  function add(snapshot) {
    return api('', { method: 'POST', body: { identity: identity(), snapshot: snapshot } })
      .then(function() { return load(); });
  }

  function remove(productId, variantId) {
    var qs = 'productId=' + encodeURIComponent(productId);
    if (variantId) qs += '&variantId=' + encodeURIComponent(variantId);
    qs += '&' + buildIdentityQS();
    return api('?' + qs, { method: 'DELETE' }).then(function() { return load(); });
  }

  // ---- One-time guest→email merge after login ----
  function maybeMerge() {
    var email = customerEmail();
    if (!email) return;
    var key = MERGE_KEY + ':' + email.toLowerCase();
    try { if (localStorage.getItem(key)) return; } catch (e) {}
    fetch(API_ORIGIN + '/api/storefront/wishlist/merge?shop=' + encodeURIComponent(SHOP || ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        email: email,
        shopifyCustomerId: customerId() || undefined,
      }),
    }).then(function() {
      try { localStorage.setItem(key, '1'); } catch (e) {}
      load();
    }).catch(function() {});
  }

  // ---- PDP product snapshot ----
  function detectProduct() {
    var path = window.location.pathname || '';
    var m = path.match(/\\/products\\/([^\\/?#]+)/);
    if (!m) return null;
    var handle = m[1];

    var pid = null, title = null, image = null, price, currency = null, variantId = null;
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      var p = window.ShopifyAnalytics.meta.product;
      if (p.id) pid = String(p.id);
      if (p.variants && p.variants.length === 1) variantId = String(p.variants[0].id);
    }
    var form = document.querySelector('form[action^="/cart/add"]');
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

  function isSaved(productId) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].shopifyProductId === productId) return true;
    }
    return false;
  }

  // ---- PDP heart button ----
  function mountPdpButton() {
    var snap = detectProduct();
    if (!snap) return;
    var form = document.querySelector('form[action^="/cart/add"]');
    if (!form || form.querySelector('.wl-pdp-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wl-pdp-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span class="wl-pdp-btn-label">' + escapeHtml(state.config.buttonLabel.unsaved) + '</span>';
    btn.addEventListener('click', function() {
      var current = detectProduct();
      if (!current) return;
      btn.disabled = true;
      var op = isSaved(current.shopifyProductId)
        ? remove(current.shopifyProductId, current.shopifyVariantId).then(function() { toast('Removed from wishlist'); })
        : add(current).then(function() {
            toast('Saved to wishlist');
            maybeShowEmailCapture();
          });
      op.finally(function() { btn.disabled = false; });
    });
    // Position controlled by config: most themes want the button at the
    // end of the cart form, but some place it ABOVE the buy box.
    if (state.config.buttonPosition === 'prepend') {
      form.insertBefore(btn, form.firstChild);
    } else {
      form.appendChild(btn);
    }
    watchVariantChanges(form);
    refreshPdpButton();
  }

  function refreshPdpButton() {
    var btn = document.querySelector('.wl-pdp-btn');
    if (!btn) return;
    var snap = detectProduct();
    var label = btn.querySelector('.wl-pdp-btn-label');
    if (!snap) return;
    var saved = isSaved(snap.shopifyProductId);
    btn.classList.toggle('wl-pdp-btn--saved', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    if (label) {
      label.textContent = saved
        ? state.config.buttonLabel.saved
        : state.config.buttonLabel.unsaved;
    }
  }

  // Track variant id changes so the saved-state badge follows the
  // selection. Themes mutate either the <select> value or the hidden
  // input's value attribute, so we cover both: a 'change' listener
  // and a MutationObserver on the variant input(s).
  function watchVariantChanges(form) {
    if (!form || form.__wlVariantWatched) return;
    form.__wlVariantWatched = true;
    var inputs = form.querySelectorAll('[name="id"]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('change', refreshPdpButton);
      try {
        new MutationObserver(refreshPdpButton).observe(inputs[i], {
          attributes: true, attributeFilter: ['value'],
        });
      } catch (e) {}
    }
    // Some themes swap the entire form on variant change. Listen to
    // popstate / hashchange / cart events as a coarse fallback.
    window.addEventListener('popstate', refreshPdpButton);
    document.addEventListener('variant:change', refreshPdpButton);
  }

  // ---- Drawer ----
  function mountDrawer() {
    if (document.querySelector('.wl-drawer')) return;
    var d = document.createElement('div');
    d.className = 'wl-drawer';
    d.hidden = true;
    d.innerHTML = '<div class="wl-backdrop"></div><aside class="wl-panel" role="dialog" aria-label="Wishlist">' +
      '<header class="wl-head"><h2>Your wishlist</h2><button class="wl-close" type="button" aria-label="Close">\\u00D7</button></header>' +
      '<div class="wl-list" data-region="drawer"></div>' +
      '<footer class="wl-foot">' +
        '<button class="wl-share-btn" type="button">Share wishlist \\u2192</button>' +
        '<a class="wl-foot-link" href="/cart">View cart \\u2192</a>' +
      '</footer>' +
      '</aside>';
    document.body.appendChild(d);
    d.querySelector('.wl-backdrop').addEventListener('click', closeDrawer);
    d.querySelector('.wl-close').addEventListener('click', closeDrawer);
    d.querySelector('.wl-share-btn').addEventListener('click', shareWishlist);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  // ---- Email capture (PR4) ----
  // Shown once per device when a guest (no email yet) adds their first
  // item. Hooks into the existing /merge endpoint so the typed email
  // immediately upgrades the wishlist from device-keyed to email-keyed.
  var EMAIL_CAPTURE_DISMISS_KEY = '__wl_email_capture_dismissed';

  function emailCaptureDismissed() {
    try { return localStorage.getItem(EMAIL_CAPTURE_DISMISS_KEY) === '1'; }
    catch (e) { return false; }
  }

  function dismissEmailCapture() {
    try { localStorage.setItem(EMAIL_CAPTURE_DISMISS_KEY, '1'); } catch (e) {}
    var el = document.querySelector('.wl-capture');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function maybeShowEmailCapture() {
    if (!state.config.emailCapture || !state.config.emailCapture.enabled) return;
    if (emailCaptureDismissed()) return;
    if (customerEmail()) return; // already known
    if (state.items.length < 1) return;
    openDrawer();
    renderEmailCapture();
  }

  function renderEmailCapture() {
    var host = document.querySelector('.wl-drawer .wl-list[data-region="drawer"]');
    if (!host || host.querySelector('.wl-capture')) return;
    var cfg = state.config.emailCapture || DEFAULT_CONFIG.emailCapture;
    var div = document.createElement('div');
    div.className = 'wl-capture';
    div.innerHTML = '<button class="wl-capture-close" type="button" aria-label="Dismiss">\\u00D7</button>' +
      '<p class="wl-capture-headline">' + escapeHtml(cfg.headline) + '</p>' +
      '<form class="wl-capture-form">' +
      '<input class="wl-capture-input" type="email" required placeholder="you@example.com" autocomplete="email" />' +
      '<button class="wl-capture-cta" type="submit">' + escapeHtml(cfg.cta) + '</button>' +
      '</form>';
    host.insertBefore(div, host.firstChild);
    div.querySelector('.wl-capture-close').addEventListener('click', dismissEmailCapture);
    div.querySelector('.wl-capture-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var input = div.querySelector('.wl-capture-input');
      var email = (input && input.value || '').trim();
      if (!email) return;
      var cta = div.querySelector('.wl-capture-cta');
      if (cta) cta.disabled = true;
      fetch(API_ORIGIN + '/api/storefront/wishlist/merge?shop=' + encodeURIComponent(SHOP || ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId(), email: email }),
        credentials: 'omit',
      }).then(function() {
        try { localStorage.setItem('__wl_merged_to:' + email.toLowerCase(), '1'); } catch (e) {}
        dismissEmailCapture();
        toast('List saved to ' + email);
        load();
      }).catch(function() {
        if (cta) cta.disabled = false;
        toast('Could not save list');
      });
    });
  }

  // ---- Share ----
  function shareWishlist() {
    if (state.items.length === 0) {
      toast('Add an item before sharing');
      return;
    }
    var btn = document.querySelector('.wl-share-btn');
    if (btn) btn.disabled = true;
    fetch(API_ORIGIN + '/api/storefront/wishlist/share?shop=' + encodeURIComponent(SHOP || ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: identity() }),
      credentials: 'omit',
    }).then(function(r) { return r.json(); }).then(function(r) {
      if (btn) btn.disabled = false;
      if (!r || !r.url) { toast('Could not create share link'); return; }
      // Prefer native share sheet on mobile, fall back to clipboard.
      if (navigator.share) {
        navigator.share({ title: 'My wishlist', url: r.url })
          .catch(function() { copyShareUrl(r.url); });
      } else {
        copyShareUrl(r.url);
      }
    }).catch(function() {
      if (btn) btn.disabled = false;
      toast('Could not create share link');
    });
  }

  function copyShareUrl(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() {
        toast('Share link copied');
      }).catch(function() { promptShareUrl(url); });
    } else {
      promptShareUrl(url);
    }
  }

  function promptShareUrl(url) {
    try { window.prompt('Copy your wishlist link:', url); } catch (e) { toast(url); }
  }

  function openDrawer() {
    var d = document.querySelector('.wl-drawer');
    if (!d) return;
    d.hidden = false;
    requestAnimationFrame(function() { d.classList.add('wl-drawer--open'); });
    renderList(d.querySelector('[data-region="drawer"]'));
  }

  function closeDrawer() {
    var d = document.querySelector('.wl-drawer');
    if (!d) return;
    d.classList.remove('wl-drawer--open');
    setTimeout(function() { d.hidden = true; }, 220);
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

  function renderList(host) {
    if (!host) return;
    if (!state.loaded) {
      host.innerHTML = '<p class="wl-empty">Loading\\u2026</p>';
      return;
    }
    if (state.items.length === 0) {
      host.innerHTML = '<p class="wl-empty">Your wishlist is empty. Tap the heart on a product to save it.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      var thumb = it.imageUrl
        ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="" loading="lazy" />'
        : '<div class="wl-thumb-placeholder"></div>';
      html += '<article class="wl-item">' +
        '<a class="wl-item-link" href="/products/' + escapeHtml(it.productHandle) + '">' +
        thumb +
        '<div class="wl-item-meta">' +
        '<div class="wl-item-title">' + escapeHtml(it.productTitle) + '</div>' +
        (it.variantTitle ? '<div class="wl-item-variant">' + escapeHtml(it.variantTitle) + '</div>' : '') +
        (it.priceAmount ? '<div class="wl-item-price">' + escapeHtml(formatPrice(it.priceAmount, it.priceCurrency)) + '</div>' : '') +
        '</div></a>' +
        '<button class="wl-item-remove" type="button" data-product="' + escapeHtml(it.shopifyProductId) +
        '" data-variant="' + escapeHtml(it.shopifyVariantId || '') + '" aria-label="Remove">\\u00D7</button>' +
        '</article>';
    }
    host.innerHTML = html;
    var btns = host.querySelectorAll('.wl-item-remove');
    for (var k = 0; k < btns.length; k++) {
      btns[k].addEventListener('click', function(e) {
        e.preventDefault();
        var pid = this.getAttribute('data-product');
        var vid = this.getAttribute('data-variant') || undefined;
        remove(pid, vid);
      });
    }
  }

  // ---- Triggers and badge count ----
  function refreshTriggers() {
    var count = state.items.length;
    var nodes = document.querySelectorAll('[data-wishlist-trigger]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var badge = el.querySelector('.wl-trigger-count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wl-trigger-count';
        el.appendChild(badge);
      }
      badge.textContent = count > 0 ? String(count) : '';
      badge.style.display = count > 0 ? '' : 'none';
    }
  }

  function bindTriggers() {
    document.addEventListener('click', function(e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-wishlist-trigger]') : null;
      if (t) { e.preventDefault(); openDrawer(); }
    });
  }

  // ---- Optional inline page render ----
  function mountInlinePage() {
    var host = document.querySelector('#wishlist-page');
    if (!host) return;
    host.classList.add('wl-page');
    host.innerHTML = '<div class="wl-list" data-region="page"></div>';
    renderList(host.querySelector('[data-region="page"]'));
    listeners.push(function() { renderList(host.querySelector('[data-region="page"]')); });
  }

  // ---- Toast ----
  function toast(msg) {
    var prev = document.querySelector('.wl-toast');
    if (prev) prev.remove();
    var t = document.createElement('div');
    t.className = 'wl-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('wl-toast--in'); });
    setTimeout(function() { t.classList.remove('wl-toast--in'); }, 2200);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2500);
  }

  // ---- Render coordinator ----
  function renderAll() {
    refreshPdpButton();
    refreshTriggers();
    var d = document.querySelector('.wl-drawer[data-region="drawer"], .wl-drawer .wl-list[data-region="drawer"]');
    var drawerList = document.querySelector('.wl-drawer .wl-list[data-region="drawer"]');
    if (drawerList && !document.querySelector('.wl-drawer').hidden) renderList(drawerList);
  }

  function injectStyles() {
    if (document.querySelector('#wl-styles')) return;
    var s = document.createElement('style');
    s.id = 'wl-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function boot() {
    if (!SHOP) {
      console.warn('[wishlist] could not detect Shopify shop; widget disabled');
      return;
    }
    injectStyles();
    mountDrawer();
    mountPdpButton();
    mountInlinePage();
    bindTriggers();
    load().then(function() { maybeMerge(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__wishlist = {
    open: openDrawer, close: closeDrawer,
    add: add, remove: remove,
    reload: load,
    state: function() { return { items: state.items.slice(), loaded: state.loaded }; },
  };
})();
`;
}
