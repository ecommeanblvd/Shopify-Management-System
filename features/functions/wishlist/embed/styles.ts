/**
 * Inline CSS for the storefront wishlist widget. Lives next to the JS
 * source so changes ship as one cache-busted bundle. Kept namespaced
 * under `.wl-` so it can't collide with the theme.
 *
 * Variables let operators override accents from the theme without
 * touching this file:
 *   :root { --wl-accent: #e11d48; }
 */
export const WISHLIST_EMBED_CSS = `
  .wl-pdp-btn {
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 12px; padding: 12px 18px;
    background: transparent; border: 1px solid currentColor; border-radius: 999px;
    font: inherit; font-size: 14px; line-height: 1; color: inherit;
    cursor: pointer; transition: background-color .15s ease, color .15s ease;
  }
  .wl-pdp-btn:hover { background: rgba(0,0,0,.04); }
  .wl-pdp-btn svg { width: 18px; height: 18px; }
  .wl-pdp-btn--saved { background: var(--wl-accent, #e11d48); color: #fff; border-color: transparent; }
  .wl-pdp-btn--saved svg { fill: currentColor; }
  .wl-pdp-btn--saved:hover { background: var(--wl-accent-hover, #be123c); }

  .wl-drawer { position: fixed; inset: 0; z-index: 10000; }
  .wl-drawer[hidden] { display: none; }
  .wl-backdrop {
    position: absolute; inset: 0; background: rgba(0,0,0,0);
    transition: background-color .2s ease;
  }
  .wl-drawer--open .wl-backdrop { background: rgba(0,0,0,.4); }
  .wl-panel {
    position: absolute; top: 0; right: 0; height: 100%;
    width: min(420px, 92vw); background: #fff; color: #111;
    display: flex; flex-direction: column;
    transform: translateX(100%); transition: transform .2s ease;
    box-shadow: -8px 0 24px rgba(0,0,0,.08);
  }
  .wl-drawer--open .wl-panel { transform: translateX(0); }
  .wl-head { display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px; border-bottom: 1px solid #eee; }
  .wl-head h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: .01em; }
  .wl-close { background: none; border: 0; font-size: 24px; line-height: 1; cursor: pointer; color: inherit; padding: 0; width: 28px; height: 28px; }

  .wl-list { flex: 1; overflow-y: auto; padding: 8px; }
  .wl-empty { padding: 32px 20px; color: #666; font-size: 13px; text-align: center; }

  .wl-item { display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-radius: 8px; }
  .wl-item + .wl-item { margin-top: 4px; }
  .wl-item:hover { background: #f7f7f7; }
  .wl-item-link { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; flex: 1; min-width: 0; }
  .wl-item-link img, .wl-thumb-placeholder { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; background: #eee; flex-shrink: 0; }
  .wl-item-meta { min-width: 0; flex: 1; }
  .wl-item-title { font-size: 13px; font-weight: 500; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .wl-item-variant { font-size: 11px; color: #666; margin-top: 2px; }
  .wl-item-price { font-size: 12px; color: #111; font-variant-numeric: tabular-nums; margin-top: 4px; }
  .wl-item-remove { background: none; border: 0; cursor: pointer;
    font-size: 18px; color: #999; padding: 4px 8px; line-height: 1; }
  .wl-item-remove:hover { color: #111; }

  .wl-oos-badge {
    display: inline-block; margin-top: 6px; padding: 2px 8px;
    background: rgba(0,0,0,.08); color: #666;
    border-radius: 999px; font-size: 10px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .wl-item--oos .wl-item-link img, .wl-item--oos .wl-thumb-placeholder { opacity: .55; }
  .wl-item--oos .wl-item-title, .wl-item--oos .wl-item-price { color: #888; }

  .wl-foot { padding: 14px 20px; border-top: 1px solid #eee;
    display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .wl-foot-link { text-decoration: none; color: inherit; font-size: 13px; font-weight: 500; }
  .wl-share-btn { background: none; border: 0; padding: 0; font: inherit;
    color: inherit; cursor: pointer; font-size: 13px; font-weight: 500;
    transition: opacity .15s ease; }
  .wl-share-btn:hover { opacity: .7; }
  .wl-share-btn:disabled { opacity: .4; cursor: not-allowed; }

  .wl-trigger-count {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 5px;
    background: var(--wl-accent, #e11d48); color: #fff;
    border-radius: 999px; font-size: 10px; font-weight: 600; line-height: 1;
    margin-left: 4px; font-variant-numeric: tabular-nums;
  }

  .wl-toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(16px);
    background: #111; color: #fff; padding: 12px 18px; border-radius: 8px;
    font-size: 13px; z-index: 10001; opacity: 0;
    transition: opacity .2s ease, transform .2s ease;
    pointer-events: none;
  }
  .wl-toast--in { opacity: 1; transform: translateX(-50%) translateY(0); }

  .wl-capture {
    position: relative; margin: 10px 12px 14px;
    padding: 16px 14px 14px; border-radius: 10px;
    background: linear-gradient(180deg, rgba(0,0,0,.03), rgba(0,0,0,.06));
    border: 1px solid rgba(0,0,0,.08);
  }
  .wl-capture-close {
    position: absolute; top: 6px; right: 8px;
    background: none; border: 0; cursor: pointer;
    font-size: 16px; line-height: 1; color: #999;
    padding: 2px 6px;
  }
  .wl-capture-close:hover { color: #333; }
  .wl-capture-headline {
    margin: 0 0 10px; font-size: 13px; font-weight: 500;
    color: #111; line-height: 1.4; padding-right: 16px;
  }
  .wl-capture-form { display: flex; gap: 6px; }
  .wl-capture-input {
    flex: 1; min-width: 0;
    padding: 8px 10px; font: inherit; font-size: 12px;
    border: 1px solid rgba(0,0,0,.15); border-radius: 6px;
    background: #fff; color: #111;
  }
  .wl-capture-input:focus { outline: 2px solid var(--wl-accent, #e11d48); outline-offset: -1px; }
  .wl-capture-cta {
    padding: 8px 14px; font: inherit; font-size: 12px; font-weight: 600;
    background: var(--wl-accent, #e11d48); color: #fff;
    border: 0; border-radius: 6px; cursor: pointer;
    transition: opacity .15s ease;
  }
  .wl-capture-cta:hover { opacity: .9; }
  .wl-capture-cta:disabled { opacity: .5; cursor: not-allowed; }

  .wl-page { padding: 32px 0; }
  .wl-page .wl-list { padding: 0; max-height: none; overflow: visible; }
  .wl-page .wl-item { padding: 16px; border-bottom: 1px solid #eee; border-radius: 0; }
  .wl-page .wl-item:hover { background: transparent; }
  .wl-page .wl-empty { padding: 48px 16px; }
`;
