/**
 * Inline CSS for the Recently Viewed storefront carousel.
 * Namespaced under `.rv-` so it can't collide with the theme.
 */
export const RECENTLY_VIEWED_CSS = `
  .rv-carousel { position: relative; padding: 8px 0; }
  .rv-carousel-head {
    display: flex; align-items: baseline; justify-content: space-between;
    padding: 0 0 12px;
  }
  .rv-title {
    margin: 0; font: inherit; font-size: 14px; font-weight: 600;
    letter-spacing: .02em; color: inherit;
  }
  .rv-clear {
    background: none; border: 0; padding: 0; font: inherit; font-size: 11px;
    color: inherit; opacity: .6; cursor: pointer;
  }
  .rv-clear:hover { opacity: 1; }

  .rv-track {
    display: grid; grid-auto-flow: column; gap: 12px;
    overflow-x: auto; scroll-snap-type: x mandatory;
    grid-auto-columns: minmax(140px, 180px);
    padding-bottom: 4px;
    scrollbar-width: thin;
  }
  .rv-track::-webkit-scrollbar { height: 6px; }
  .rv-track::-webkit-scrollbar-thumb { background: rgba(0,0,0,.15); border-radius: 999px; }

  .rv-card { scroll-snap-align: start; }
  .rv-card a {
    display: block; text-decoration: none; color: inherit;
  }
  .rv-card img, .rv-thumb-placeholder {
    width: 100%; aspect-ratio: 1 / 1; object-fit: cover;
    border-radius: 6px; background: rgba(0,0,0,.04);
    display: block;
  }
  .rv-card-title {
    margin-top: 6px; font-size: 12px; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .rv-card-price {
    margin-top: 2px; font-size: 11px; font-variant-numeric: tabular-nums;
    opacity: .75;
  }

  .rv-empty {
    padding: 18px 14px; text-align: center; font-size: 12px;
    color: rgba(0,0,0,.5);
  }
`;
