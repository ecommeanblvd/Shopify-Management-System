/**
 * Gift Registry storefront i18n. Two locales for now (en + vi) — the
 * operator's stores are Vietnamese-facing so the VN copy is the
 * actual default for many shoppers.
 *
 * Locale resolution: each /gr/* page reads `?lang=` from search
 * params. Anything that isn't a known locale falls back to 'en'.
 * Keeps URLs canonical + bookmarkable; no cookie / header magic.
 *
 * Adding a new locale = append one entry to MESSAGES and the
 * KNOWN_LOCALES tuple. Types catch missing keys.
 */

export const KNOWN_LOCALES = ['en', 'vi'] as const;
export type Locale = typeof KNOWN_LOCALES[number];

export function resolveLocale(raw: string | undefined | null): Locale {
  const normalised = raw?.toLowerCase().trim();
  return (KNOWN_LOCALES as readonly string[]).includes(normalised ?? '')
    ? (normalised as Locale)
    : 'en';
}

export interface GiftRegistryMessages {
  /** Common */
  common: {
    poweredByStore: (storeName: string) => string;
    cancel: string;
    openRegistry: string;
    fromStore: string;
  };

  /** /gr/new */
  newPage: {
    eyebrow: (storeName: string) => string;
    title: string;
    subtitle: string;
    ownerEmailLabel: string;
    ownerEmailHint: string;
    ownerEmailPlaceholder: string;
    ownerNameLabel: string;
    eventNameLabel: string;
    eventNameHint: string;
    eventNamePlaceholder: string;
    eventDateLabel: string;
    messageLabel: string;
    messagePlaceholder: string;
    submitButton: string;
    submitting: string;
    createdPill: string;
    createdHeading: string;
    createdSubtitle: string;
    copy: string;
    copied: string;
    openRegistryLink: string;
    recoveryHint: string;
    recoveryLink: string;
    errorGeneric: string;
  };

  /** /gr/find */
  findPage: {
    eyebrow: (storeName: string) => string;
    title: string;
    subtitle: (storeName: string) => string;
    yourEmailLabel: string;
    yourEmailPlaceholder: string;
    submitButton: string;
    submitting: string;
    foundHeading: (n: number) => string;
    noneFound: (email: string) => string;
    itemsLabel: (n: number) => string;
    errorGeneric: string;
  };

  /** /gr/[token] */
  viewerPage: {
    eyebrow: string;
    by: string;
    emptyHeading: string;
    reservedOfWantedLabel: (reserved: number, wanted: number) => string;
    note: string;
    reserveCta: string;
    fullyReservedBadge: string;
    reservedSuccess: string;
    yourNamePlaceholder: string;
    yourEmailPlaceholder: string;
    qtyLabel: string;
    remainingLabel: (n: number) => string;
    notePlaceholder: string;
    reserveSubmit: string;
    reserving: string;
    errorGeneric: string;
    notFoundTitle: string;
  };
}

const EN: GiftRegistryMessages = {
  common: {
    poweredByStore: (s) => `From ${s}`,
    cancel: 'Cancel',
    openRegistry: 'Open your registry',
    fromStore: 'From',
  },
  newPage: {
    eyebrow: (s) => s,
    title: 'Start your registry',
    subtitle: "One short form. We'll hand you a share link to send to friends.",
    ownerEmailLabel: 'Your email',
    ownerEmailHint: 'So we can find your registry later if you lose the link.',
    ownerEmailPlaceholder: 'you@example.com',
    ownerNameLabel: 'Your name (optional)',
    eventNameLabel: 'Event name',
    eventNameHint: "What's the registry for?",
    eventNamePlaceholder: "Jane & John's Wedding",
    eventDateLabel: 'Event date (optional)',
    messageLabel: 'A note for guests (optional)',
    messagePlaceholder: 'Thanks for celebrating with us!',
    submitButton: 'Create registry',
    submitting: 'Creating…',
    createdPill: 'Registry created',
    createdHeading: 'Your share link',
    createdSubtitle:
      "Save this link — it's how guests view and reserve items on your registry. Keep it handy; we don't require an account.",
    copy: 'Copy',
    copied: 'Copied',
    openRegistryLink: 'Open your registry',
    recoveryHint: 'Lost the link to a registry you already created?',
    recoveryLink: 'Recover by email',
    errorGeneric: 'Could not create registry',
  },
  findPage: {
    eyebrow: (s) => s,
    title: 'Find your registry',
    subtitle: (s) =>
      `Enter the email you used when creating the registry. We'll list every registry you own at ${s}.`,
    yourEmailLabel: 'Your email',
    yourEmailPlaceholder: 'you@example.com',
    submitButton: 'Find my registries',
    submitting: 'Looking up…',
    foundHeading: (n) => `Found ${n} registr${n === 1 ? 'y' : 'ies'}:`,
    noneFound: (email) => `No registries found for ${email}.`,
    itemsLabel: (n) => `${n} item${n === 1 ? '' : 's'}`,
    errorGeneric: 'Lookup failed',
  },
  viewerPage: {
    eyebrow: 'Gift registry',
    by: 'by',
    emptyHeading: "The owner hasn't added items yet. Check back soon.",
    reservedOfWantedLabel: (r, w) => `${r} of ${w} reserved`,
    note: 'Note',
    reserveCta: "I'll get this",
    fullyReservedBadge: 'Fully reserved',
    reservedSuccess: 'Reserved. The registry owner will see your name.',
    yourNamePlaceholder: 'Your name',
    yourEmailPlaceholder: 'you@example.com',
    qtyLabel: 'Qty',
    remainingLabel: (n) => `(${n} remaining)`,
    notePlaceholder: 'Note for the owner (optional)',
    reserveSubmit: 'Reserve',
    reserving: 'Reserving…',
    errorGeneric: 'Could not reserve',
    notFoundTitle: 'Registry not found',
  },
};

const VI: GiftRegistryMessages = {
  common: {
    poweredByStore: (s) => `Từ ${s}`,
    cancel: 'Huỷ',
    openRegistry: 'Mở danh sách của bạn',
    fromStore: 'Từ',
  },
  newPage: {
    eyebrow: (s) => s,
    title: 'Tạo danh sách quà',
    subtitle:
      'Chỉ một biểu mẫu ngắn. Bạn sẽ nhận được link để chia sẻ với bạn bè.',
    ownerEmailLabel: 'Email của bạn',
    ownerEmailHint:
      'Để có thể tìm lại danh sách của bạn sau này nếu bạn làm mất link.',
    ownerEmailPlaceholder: 'ban@vidu.com',
    ownerNameLabel: 'Tên của bạn (tuỳ chọn)',
    eventNameLabel: 'Tên sự kiện',
    eventNameHint: 'Danh sách này dùng cho dịp gì?',
    eventNamePlaceholder: 'Đám cưới Linh & Nam',
    eventDateLabel: 'Ngày diễn ra (tuỳ chọn)',
    messageLabel: 'Lời nhắn cho khách (tuỳ chọn)',
    messagePlaceholder: 'Cảm ơn vì đã chung vui cùng chúng mình!',
    submitButton: 'Tạo danh sách',
    submitting: 'Đang tạo…',
    createdPill: 'Đã tạo xong',
    createdHeading: 'Link chia sẻ của bạn',
    createdSubtitle:
      'Hãy lưu link này — đây là nơi khách xem và đặt giữ món quà trong danh sách của bạn. Không cần tạo tài khoản, hãy giữ link cẩn thận.',
    copy: 'Sao chép',
    copied: 'Đã sao chép',
    openRegistryLink: 'Mở danh sách của bạn',
    recoveryHint: 'Bạn lỡ làm mất link của danh sách đã tạo?',
    recoveryLink: 'Khôi phục bằng email',
    errorGeneric: 'Không thể tạo danh sách',
  },
  findPage: {
    eyebrow: (s) => s,
    title: 'Tìm lại danh sách của bạn',
    subtitle: (s) =>
      `Nhập email bạn đã dùng khi tạo danh sách. Chúng tôi sẽ liệt kê mọi danh sách bạn sở hữu tại ${s}.`,
    yourEmailLabel: 'Email của bạn',
    yourEmailPlaceholder: 'ban@vidu.com',
    submitButton: 'Tìm danh sách của tôi',
    submitting: 'Đang tìm…',
    foundHeading: (n) => `Tìm thấy ${n} danh sách:`,
    noneFound: (email) => `Không có danh sách nào với email ${email}.`,
    itemsLabel: (n) => `${n} món`,
    errorGeneric: 'Tìm kiếm không thành công',
  },
  viewerPage: {
    eyebrow: 'Danh sách quà',
    by: 'của',
    emptyHeading: 'Chủ danh sách chưa thêm món quà nào. Hãy quay lại sau nhé.',
    reservedOfWantedLabel: (r, w) => `Đã giữ ${r}/${w}`,
    note: 'Ghi chú',
    reserveCta: 'Để tôi tặng món này',
    fullyReservedBadge: 'Đã có người tặng đủ',
    reservedSuccess:
      'Đã đặt giữ. Chủ danh sách sẽ thấy tên bạn trong danh sách.',
    yourNamePlaceholder: 'Tên của bạn',
    yourEmailPlaceholder: 'ban@vidu.com',
    qtyLabel: 'Số lượng',
    remainingLabel: (n) => `(còn lại ${n})`,
    notePlaceholder: 'Lời nhắn cho chủ danh sách (tuỳ chọn)',
    reserveSubmit: 'Đặt giữ',
    reserving: 'Đang lưu…',
    errorGeneric: 'Không thể đặt giữ',
    notFoundTitle: 'Không tìm thấy danh sách',
  },
};

const MESSAGES: Record<Locale, GiftRegistryMessages> = { en: EN, vi: VI };

export function getMessages(locale: Locale): GiftRegistryMessages {
  return MESSAGES[locale];
}

/** Builds a same-route href with `?lang=` swapped. Used by the
 *  in-page locale switcher. */
export function withLocale(currentPath: string, target: Locale): string {
  const [base, query] = currentPath.split('?');
  const params = new URLSearchParams(query ?? '');
  params.set('lang', target);
  return `${base}?${params.toString()}`;
}
