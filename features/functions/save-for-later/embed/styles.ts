/**
 * Inline CSS for the Save-for-later cart embed. Namespaced under `.sfl-`.
 */
export const SAVE_FOR_LATER_CSS = `
  .sfl-row-action {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 6px;
    background: none; border: 0; padding: 0;
    font: inherit; font-size: 12px; color: inherit;
    cursor: pointer; opacity: .7;
    transition: opacity .15s ease;
  }
  .sfl-row-action:hover { opacity: 1; }
  .sfl-row-action svg { width: 13px; height: 13px; }

  .sfl-panel {
    margin: 32px 0 24px;
    padding: 18px 0 6px;
    border-top: 1px solid rgba(0,0,0,.1);
  }
  .sfl-panel-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px;
  }
  .sfl-panel-title {
    margin: 0; font: inherit; font-size: 15px; font-weight: 600;
    letter-spacing: .01em;
  }
  .sfl-panel-count {
    font-size: 11px; opacity: .6;
    font-variant-numeric: tabular-nums;
  }

  .sfl-list { display: grid; gap: 10px; }
  .sfl-item {
    display: grid;
    grid-template-columns: 64px 1fr auto;
    align-items: center; gap: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(0,0,0,.08);
    border-radius: 8px;
    background: rgba(255,255,255,.6);
  }
  .sfl-item-thumb, .sfl-item-placeholder {
    width: 64px; height: 64px; object-fit: cover;
    border-radius: 6px; background: rgba(0,0,0,.04);
  }
  .sfl-item-meta { min-width: 0; }
  .sfl-item-title {
    font-size: 13px; font-weight: 500; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .sfl-item-sub {
    font-size: 11px; opacity: .7; margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .sfl-item-actions {
    display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
  }
  .sfl-btn-restore {
    font: inherit; font-size: 11px; font-weight: 600;
    padding: 6px 10px; border-radius: 6px;
    background: var(--sfl-accent, #7c3aed); color: #fff;
    border: 0; cursor: pointer; white-space: nowrap;
    transition: background-color .15s ease;
  }
  .sfl-btn-restore:hover { background: var(--sfl-accent-hover, #6d28d9); }
  .sfl-btn-restore:disabled { opacity: .5; cursor: not-allowed; }
  .sfl-btn-remove {
    font: inherit; font-size: 11px;
    background: none; border: 0; padding: 4px 6px;
    color: inherit; opacity: .55; cursor: pointer;
  }
  .sfl-btn-remove:hover { opacity: 1; }

  .sfl-toast {
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%) translateY(16px);
    background: #111; color: #fff; padding: 12px 18px; border-radius: 8px;
    font-size: 13px; z-index: 10001; opacity: 0; pointer-events: none;
    transition: opacity .2s ease, transform .2s ease;
  }
  .sfl-toast--in { opacity: 1; transform: translateX(-50%) translateY(0); }
`;
