/**
 * Zod validation for the MMP product webhook envelope. Mirrors the
 * MMP team's contract — every field marked OPTIONAL in their spec is
 * `.optional()` here, REQUIRED ones throw a 400 with a clear error.
 *
 * Why `.passthrough()` on the product / variant / image objects:
 * MMP must be free to add new metadata fields without coordinating a
 * SMS deploy. Strict mode would 400 the entire batch on a single new
 * key — that's hostile to forward compatibility.
 */

import { z } from 'zod';

const moneyVnd = z
  .number({ error: 'expected VND amount as a non-negative integer' })
  .int()
  .nonnegative();

const moneyUsd = z
  .number({ error: 'expected USD amount as a non-negative number' })
  .nonnegative()
  // Two decimal places max — enforce on the data shape, not via
  // rounding (silent rounding hides MMP bugs).
  .refine((n) => Number.isFinite(n) && Math.round(n * 100) === n * 100, {
    message: 'USD price must have at most 2 decimal places',
  });

export const mmpVariantSchema = z
  .object({
    sku: z.string().min(1, 'variant.sku required'),
    color: z.string().optional(),
    size: z.string().optional(),
    inventory: z
      .number({ error: 'variant.inventory required as a non-negative integer' })
      .int()
      .nonnegative(),
    price: moneyVnd,
    lengthCm: z.number().positive().optional(),
    lengthCmMax: z.number().positive().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const mmpImageSchema = z
  .object({
    url: z.string().url('image.url must be a valid URL'),
    position: z.number().int().nonnegative().optional(),
    role: z.string().optional(),
    isThumbnail: z.boolean().optional(),
    altText: z.string().optional(),
  })
  .passthrough();

export const mmpProductSchema = z
  .object({
    portalProductId: z.string().min(1, 'portalProductId required'),
    brandSlug: z.string().min(1, 'brandSlug required'),
    sku: z.string().min(1, 'product.sku required'),
    name: z.string().min(1, 'name required'),
    globalName: z.string().optional(),
    shortSummary: z.string().optional(),
    description: z.string().optional(),
    collection: z.string().optional(),
    productType: z.string().optional(),
    status: z.enum(['live', 'draft', 'archived']),
    basePrice: moneyVnd,
    currency: z.literal('VND', { error: 'currency must be "VND"' }),
    priceUsd: moneyUsd.optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    variants: z.array(mmpVariantSchema).min(1, 'at least one variant required'),
    images: z.array(mmpImageSchema).optional(),
  })
  .passthrough()
  // Variant SKUs must be unique within a product — DB uniqueIndex
  // enforces this too, but failing in Zod gives a clearer 400 message.
  .refine(
    (p) => {
      const skus = p.variants.map((v) => v.sku);
      return new Set(skus).size === skus.length;
    },
    { message: 'variant SKUs must be unique within a product' },
  );

export const mmpEnvelopeSchema = z
  .object({
    products: z.array(mmpProductSchema).min(1, 'products array cannot be empty'),
  })
  .strict();

export type MmpVariant = z.infer<typeof mmpVariantSchema>;
export type MmpImage = z.infer<typeof mmpImageSchema>;
export type MmpProduct = z.infer<typeof mmpProductSchema>;
export type MmpEnvelope = z.infer<typeof mmpEnvelopeSchema>;
