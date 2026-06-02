/**
 * Inline CSS for the Gift Registry PDP button + modal. Namespaced
 * under `.gr-` so it can't collide with the theme.
 */
export const GIFT_REGISTRY_EMBED_CSS = `
  .gr-pdp-btn {
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 12px; padding: 12px 18px;
    background: transparent; border: 1px solid currentColor; border-radius: 999px;
    font: inherit; font-size: 14px; line-height: 1; color: inherit;
    cursor: pointer; transition: background-color .15s ease;
  }
  .gr-pdp-btn:hover { background: rgba(0,0,0,.04); }
  .gr-pdp-btn svg { width: 18px; height: 18px; }

  .gr-modal { position: fixed; inset: 0; z-index: 10000; }
  .gr-modal[hidden] { display: none; }
  .gr-modal-back {
    position: absolute; inset: 0; background: rgba(0,0,0,0);
    transition: background-color .2s ease;
  }
  .gr-modal--open .gr-modal-back { background: rgba(0,0,0,.45); }
  .gr-modal-card {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, calc(-50% + 16px));
    width: min(440px, 92vw); max-height: 86vh; overflow-y: auto;
    background: #fff; color: #111; border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0,0,0,.18);
    transition: transform .25s ease, opacity .2s ease;
    opacity: 0;
  }
  .gr-modal--open .gr-modal-card {
    transform: translate(-50%, -50%); opacity: 1;
  }
  .gr-modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px 8px;
  }
  .gr-modal-title { margin: 0; font-size: 16px; font-weight: 600; }
  .gr-modal-close {
    background: none; border: 0; cursor: pointer;
    font-size: 22px; color: #888; padding: 0 4px; line-height: 1;
  }
  .gr-modal-body { padding: 8px 20px 20px; }

  .gr-step + .gr-step { margin-top: 16px; }
  .gr-field { display: block; margin-top: 12px; }
  .gr-field-label { display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: .04em; color: #666; margin-bottom: 6px; }
  .gr-input, .gr-textarea {
    width: 100%; box-sizing: border-box;
    padding: 8px 10px; font: inherit; font-size: 13px;
    border: 1px solid rgba(0,0,0,.15); border-radius: 6px;
    background: #fff; color: #111;
  }
  .gr-textarea { resize: vertical; min-height: 60px; }
  .gr-input:focus, .gr-textarea:focus {
    outline: 2px solid #d97706; outline-offset: -1px;
  }

  .gr-list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .gr-list-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(0,0,0,.08); background: #fff;
    transition: background-color .12s ease, border-color .12s ease;
  }
  .gr-list-item:hover { background: #faf7f2; border-color: rgba(217,119,6,.4); }
  .gr-list-item-meta { min-width: 0; }
  .gr-list-item-name {
    font-weight: 500; font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .gr-list-item-sub { font-size: 11px; color: #888; margin-top: 2px; }
  .gr-list-item-count {
    font-size: 11px; font-variant-numeric: tabular-nums;
    background: rgba(0,0,0,.06); padding: 2px 8px;
    border-radius: 999px; color: #555;
  }

  .gr-actions {
    display: flex; align-items: center; gap: 10px; margin-top: 18px;
  }
  .gr-btn-primary {
    flex: 1;
    padding: 10px 14px; font: inherit; font-size: 13px; font-weight: 600;
    background: #d97706; color: #fff;
    border: 0; border-radius: 8px; cursor: pointer;
    transition: background-color .15s ease;
  }
  .gr-btn-primary:hover { background: #b45309; }
  .gr-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .gr-btn-link {
    background: none; border: 0; font: inherit; font-size: 12px;
    color: #666; cursor: pointer; padding: 6px 4px;
  }
  .gr-btn-link:hover { color: #111; }

  .gr-row { display: flex; gap: 10px; }
  .gr-row > * { flex: 1; }

  .gr-error {
    margin-top: 10px; padding: 8px 12px; font-size: 12px;
    color: #b91c1c; background: #fef2f2; border-radius: 6px;
  }

  .gr-toast {
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%) translateY(16px);
    background: #111; color: #fff; padding: 12px 18px; border-radius: 8px;
    font-size: 13px; z-index: 10001; opacity: 0; pointer-events: none;
    transition: opacity .2s ease, transform .2s ease;
  }
  .gr-toast--in { opacity: 1; transform: translateX(-50%) translateY(0); }
`;
