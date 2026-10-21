import { InventoryReason, Prisma, type ProductCategory } from "@prisma/client";
import { parse } from "csv-parse/sync";

import { CLOUDINARY_UPLOAD_FOLDER, getCloudinaryClient } from "../lib/cloudinary";
import { prisma } from "../lib/prisma";
import {
  MAX_PRODUCT_IMAGES,
  bulkProductRowSchema,
  toProductValidationDetails,
  type BulkProductRow,
  type ProductInput,
  type ProductPatch,
  type ValidationDetail,
} from "../validation/products.schemas";

export const PRODUCT_IMAGE_ADD_ACTION = "PRODUCT_IMAGE_ADD";
export const PRODUCT_BULK_CREATE_ACTION = "PRODUCT_BULK_CREATE";
export const PRODUCT_BULK_UPDATE_ACTION = "PRODUCT_BULK_UPDATE";
export const PRODUCT_CREATE_ACTION = "PRODUCT_CREATE";
export const PRODUCT_UPDATE_ACTION = "PRODUCT_UPDATE";
export const COLOR_RESTOCK_ACTION = "COLOR_RESTOCK";

const PRODUCT_ENTITY = "Product";
const COLOR_ENTITY = "Color";
const ADJUSTMENT_NOTE_BULK_IMPORT = "Bulk import";
const ADJUSTMENT_NOTE_BULK_EDIT = "Bulk edit";
const ADJUSTMENT_NOTE_CREATE = "Product created";
const ADJUSTMENT_NOTE_PATCH = "Product updated";

export class UnsupportedImageError extends Error {}
export class ProductNotFoundError extends Error {}
export class ImageLimitError extends Error {}
export class CsvParseError extends Error {}
export class StockConflictError extends Error {}

export class BulkRowError extends Error {
  readonly row: number;
  readonly issues: ValidationDetail[];

  constructor(row: number, issues: ValidationDetail[]) {
    super(`Row ${row} failed`);
    this.row = row;
    this.issues = issues;
  }
}

export type ImageFormat = "jpeg" | "png" | "webp";

// The first bytes decide the format. A filename or a client-supplied content
// type is attacker controlled, so neither is ever consulted.
export function sniffImageFormat(buffer: Buffer): ImageFormat | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    buffer.length >= pngSignature.length &&
    pngSignature.every((byte, index) => buffer[index] === byte)
  ) {
    return "png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export interface AddProductImageParams {
  productId: string;
  adminId: string;
  buffer: Buffer;
}

export interface AddProductImageResult {
  image: { url: string; publicId: string };
  images: string[];
}

export async function addProductImage(
  params: AddProductImageParams,
): Promise<AddProductImageResult> {
  const { productId, adminId, buffer } = params;

  if (sniffImageFormat(buffer) === null) {
    throw new UnsupportedImageError();
  }

  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { images: true },
  });
  if (!existing) {
    throw new ProductNotFoundError();
  }
  if (existing.images.length >= MAX_PRODUCT_IMAGES) {
    throw new ImageLimitError();
  }

  const client = getCloudinaryClient();
  const asset = await client.upload(buffer, CLOUDINARY_UPLOAD_FOLDER);

  try {
    const images = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { images: true },
      });
      if (!product) {
        throw new ProductNotFoundError();
      }
      if (product.images.length >= MAX_PRODUCT_IMAGES) {
        throw new ImageLimitError();
      }

      await tx.product.update({
        where: { id: productId },
        data: { images: { push: asset.secureUrl } },
      });
      await tx.adminLog.create({
        data: {
          adminId,
          action: PRODUCT_IMAGE_ADD_ACTION,
          entity: PRODUCT_ENTITY,
          entityId: productId,
          meta: { publicId: asset.publicId, imageUrl: asset.secureUrl },
        },
      });

      return [...product.images, asset.secureUrl];
    });

    return {
      image: { url: asset.secureUrl, publicId: asset.publicId },
      images,
    };
  } catch (error) {
    // Cloudinary already accepted the file while the database refused it.
    // Remove the asset so no orphan is left behind.
    try {
      await client.destroy(asset.publicId);
    } catch (cleanupError) {
      console.error(
        "Failed to delete the uploaded asset:",
        cleanupError instanceof Error ? cleanupError.message : "unknown error",
      );
    }
    throw error;
  }
}

export type CsvRow = Record<string, string>;

const OPTIONAL_CSV_FIELDS = new Set(["id", "description", "isActive"]);

function isStringRecord(value: unknown): value is CsvRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

export function parseProductCsv(text: string): CsvRow[] {
  let parsed: unknown;
  try {
    parsed = parse(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (error) {
    console.error(
      "CSV parse failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    throw new CsvParseError();
  }

  if (!Array.isArray(parsed)) {
    throw new CsvParseError();
  }

  const rows: CsvRow[] = [];
  for (const entry of parsed) {
    if (!isStringRecord(entry)) {
      throw new CsvParseError();
    }
    rows.push(entry);
  }
  return rows;
}

function normalizeRow(row: CsvRow): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmed = value.trim();
    normalized[key] =
      trimmed === "" && OPTIONAL_CSV_FIELDS.has(key) ? undefined : value;
  }
  return normalized;
}

export interface BulkRowIssue {
  row: number;
  errors: ValidationDetail[];
}

export interface BulkSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  creates: number;
  updates: number;
  stockAdjustments: number;
}

export interface BulkImportResult {
  mode: "dry-run" | "commit";
  committed: boolean;
  summary: BulkSummary;
  errors: BulkRowIssue[];
}

interface PlannedRow {
  row: number;
  id: string | undefined;
  data: BulkProductRow;
}

function emptySummary(totalRows: number): BulkSummary {
  return {
    totalRows,
    validRows: 0,
    invalidRows: 0,
    creates: 0,
    updates: 0,
    stockAdjustments: 0,
  };
}

function matchesColorName(existingName: string, incomingName: string): boolean {
  return existingName.trim().toLowerCase() === incomingName.trim().toLowerCase();
}

async function commitPlannedRows(
  tx: Prisma.TransactionClient,
  adminId: string,
  rows: PlannedRow[],
): Promise<{ creates: number; updates: number; stockAdjustments: number }> {
  let creates = 0;
  let updates = 0;
  let stockAdjustments = 0;

  for (const item of rows) {
    if (item.id === undefined) {
      const product = await tx.product.create({
        data: {
          name: item.data.name,
          brand: item.data.brand,
          category: item.data.category,
          description: item.data.description ?? null,
          basePrice: new Prisma.Decimal(item.data.basePrice),
          isActive: item.data.isActive ?? true,
          images: [],
          colors: {
            create: item.data.colors.map((color) => ({
              name: color.name,
              stock: color.stock,
            })),
          },
        },
        select: { id: true, colors: { select: { id: true, stock: true } } },
      });

      for (const color of product.colors) {
        if (color.stock === 0) continue;
        await tx.inventoryLog.create({
          data: {
            colorId: color.id,
            change: color.stock,
            reason: InventoryReason.ADJUSTMENT,
            note: ADJUSTMENT_NOTE_BULK_IMPORT,
          },
        });
        stockAdjustments += 1;
      }

      await tx.adminLog.create({
        data: {
          adminId,
          action: PRODUCT_BULK_CREATE_ACTION,
          entity: PRODUCT_ENTITY,
          entityId: product.id,
          meta: { row: item.row },
        },
      });
      creates += 1;
      continue;
    }

    const existing = await tx.product.findUnique({
      where: { id: item.id },
      select: {
        id: true,
        colors: { select: { id: true, name: true, stock: true } },
      },
    });
    if (!existing) {
      throw new BulkRowError(item.row, [
        { field: "id", message: "Product not found" },
      ]);
    }

    await tx.product.update({
      where: { id: existing.id },
      data: {
        name: item.data.name,
        brand: item.data.brand,
        category: item.data.category,
        basePrice: new Prisma.Decimal(item.data.basePrice),
        ...(item.data.description !== undefined
          ? { description: item.data.description }
          : {}),
        ...(item.data.isActive !== undefined
          ? { isActive: item.data.isActive }
          : {}),
      },
    });

    for (const color of item.data.colors) {
      const current = existing.colors.find((candidate) =>
        matchesColorName(candidate.name, color.name),
      );

      if (current) {
        const delta = color.stock - current.stock;
        if (delta === 0) continue;

        const updated = await tx.color.updateMany({
          where: { id: current.id, stock: { gte: -delta } },
          data: { stock: { increment: delta } },
        });
        if (updated.count !== 1) {
          throw new BulkRowError(item.row, [
            {
              field: `colors.${color.name}`,
              message: "Stock changed while importing, run the file again",
            },
          ]);
        }
        await tx.inventoryLog.create({
          data: {
            colorId: current.id,
            change: delta,
            reason: InventoryReason.ADJUSTMENT,
            note: ADJUSTMENT_NOTE_BULK_EDIT,
          },
        });
        stockAdjustments += 1;
        continue;
      }

      const created = await tx.color.create({
        data: {
          productId: existing.id,
          name: color.name,
          stock: color.stock,
        },
        select: { id: true },
      });
      if (color.stock !== 0) {
        await tx.inventoryLog.create({
          data: {
            colorId: created.id,
            change: color.stock,
            reason: InventoryReason.ADJUSTMENT,
            note: ADJUSTMENT_NOTE_BULK_EDIT,
          },
        });
        stockAdjustments += 1;
      }
    }

    await tx.adminLog.create({
      data: {
        adminId,
        action: PRODUCT_BULK_UPDATE_ACTION,
        entity: PRODUCT_ENTITY,
        entityId: existing.id,
        meta: { row: item.row },
      },
    });
    updates += 1;
  }

  return { creates, updates, stockAdjustments };
}

export async function runBulkProductImport(params: {
  adminId: string;
  rows: CsvRow[];
  confirm: boolean;
}): Promise<BulkImportResult> {
  const { adminId, rows, confirm } = params;
  const mode = confirm ? "commit" : "dry-run";
  const summary = emptySummary(rows.length);
  const errors: BulkRowIssue[] = [];
  const planned: PlannedRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const row = rows[index] ?? {};
    const parsed = bulkProductRowSchema.safeParse(normalizeRow(row));
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        errors: toProductValidationDetails(parsed.error),
      });
      continue;
    }
    planned.push({ row: rowNumber, id: parsed.data.id, data: parsed.data });
  }

  const seenIds = new Map<string, number>();
  const duplicateRows = new Set<number>();
  for (const item of planned) {
    if (item.id === undefined) continue;
    const firstRow = seenIds.get(item.id);
    if (firstRow !== undefined) {
      duplicateRows.add(item.row);
      errors.push({
        row: item.row,
        errors: [{ field: "id", message: `Duplicate of row ${firstRow}` }],
      });
      continue;
    }
    seenIds.set(item.id, item.row);
  }
  const deduplicated = planned.filter((item) => !duplicateRows.has(item.row));

  const requestedIds = [...seenIds.keys()];
  const existingProducts =
    requestedIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: requestedIds } },
          select: {
            id: true,
            colors: { select: { id: true, name: true, stock: true } },
          },
        })
      : [];
  const existingById = new Map(
    existingProducts.map((product) => [product.id, product]),
  );

  const verified: PlannedRow[] = [];
  for (const item of deduplicated) {
    if (item.id !== undefined && !existingById.has(item.id)) {
      errors.push({
        row: item.row,
        errors: [{ field: "id", message: "Product not found" }],
      });
      continue;
    }
    verified.push(item);
  }

  summary.invalidRows = errors.length;
  summary.validRows = verified.length;
  summary.creates = verified.filter((item) => item.id === undefined).length;
  summary.updates = verified.length - summary.creates;
  summary.stockAdjustments = verified.reduce((count, item) => {
    if (item.id === undefined) {
      return count + item.data.colors.filter((color) => color.stock !== 0).length;
    }
    const existing = existingById.get(item.id);
    if (!existing) return count;
    return (
      count +
      item.data.colors.filter((color) => {
        const current = existing.colors.find((candidate) =>
          matchesColorName(candidate.name, color.name),
        );
        return current ? current.stock !== color.stock : color.stock !== 0;
      }).length
    );
  }, 0);

  if (errors.length > 0 || !confirm) {
    return { mode, committed: false, summary, errors };
  }

  let outcome: { creates: number; updates: number; stockAdjustments: number };
  try {
    outcome = await prisma.$transaction((tx) =>
      commitPlannedRows(tx, adminId, verified),
    );
  } catch (error) {
    if (error instanceof BulkRowError) {
      return {
        mode,
        committed: false,
        summary,
        errors: [{ row: error.row, errors: error.issues }],
      };
    }
    throw error;
  }

  summary.creates = outcome.creates;
  summary.updates = outcome.updates;
  summary.stockAdjustments = outcome.stockAdjustments;

  return { mode, committed: true, summary, errors };
}

export interface AdminProductColor {
  id: string;
  name: string;
  stock: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  description: string | null;
  basePrice: string;
  isActive: boolean;
  images: string[];
  colors: AdminProductColor[];
}

const ADMIN_PRODUCT_SELECT = {
  id: true,
  name: true,
  brand: true,
  category: true,
  description: true,
  basePrice: true,
  isActive: true,
  images: true,
  colors: {
    select: { id: true, name: true, stock: true },
    orderBy: { name: "asc" },
  },
} satisfies Prisma.ProductSelect;

type AdminProductRecord = Prisma.ProductGetPayload<{
  select: typeof ADMIN_PRODUCT_SELECT;
}>;

type MetaValue = string | boolean | null | { name: string; stock: number }[];
type ChangeMeta = Record<string, MetaValue>;

function toAdminProduct(product: AdminProductRecord): AdminProduct {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
    basePrice: product.basePrice.toString(),
    isActive: product.isActive,
    images: product.images,
    colors: product.colors,
  };
}

export async function listAllProducts(): Promise<AdminProduct[]> {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    select: ADMIN_PRODUCT_SELECT,
  });
  return products.map((product) => toAdminProduct(product));
}

export async function createProduct(
  input: ProductInput,
  adminId: string,
): Promise<AdminProduct> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        brand: input.brand,
        category: input.category,
        description: input.description ?? null,
        basePrice: new Prisma.Decimal(input.basePrice),
        isActive: input.isActive ?? true,
        images: [],
        colors: {
          create: input.colors.map((color) => ({
            name: color.name,
            stock: color.stock,
          })),
        },
      },
      select: ADMIN_PRODUCT_SELECT,
    });

    for (const color of product.colors) {
      if (color.stock === 0) continue;
      await tx.inventoryLog.create({
        data: {
          colorId: color.id,
          change: color.stock,
          reason: InventoryReason.ADJUSTMENT,
          note: ADJUSTMENT_NOTE_CREATE,
        },
      });
    }

    const meta: ChangeMeta = {
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
      basePrice: product.basePrice.toString(),
      isActive: product.isActive,
      colors: product.colors.map((color) => ({
        name: color.name,
        stock: color.stock,
      })),
    };

    await tx.adminLog.create({
      data: {
        adminId,
        action: PRODUCT_CREATE_ACTION,
        entity: PRODUCT_ENTITY,
        entityId: product.id,
        meta,
      },
    });

    return toAdminProduct(product);
  });
}

export async function updateProduct(
  id: string,
  patch: ProductPatch,
  adminId: string,
): Promise<AdminProduct> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({
      where: { id },
      select: ADMIN_PRODUCT_SELECT,
    });
    if (!current) {
      throw new ProductNotFoundError();
    }

    const data: Prisma.ProductUpdateInput = {};
    const before: ChangeMeta = {};
    const after: ChangeMeta = {};

    if (patch.name !== undefined && patch.name !== current.name) {
      data.name = patch.name;
      before.name = current.name;
      after.name = patch.name;
    }
    if (patch.brand !== undefined && patch.brand !== current.brand) {
      data.brand = patch.brand;
      before.brand = current.brand;
      after.brand = patch.brand;
    }
    if (patch.category !== undefined && patch.category !== current.category) {
      data.category = patch.category;
      before.category = current.category;
      after.category = patch.category;
    }
    if (
      patch.description !== undefined &&
      patch.description !== current.description
    ) {
      data.description = patch.description;
      before.description = current.description;
      after.description = patch.description;
    }
    if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
      data.isActive = patch.isActive;
      before.isActive = current.isActive;
      after.isActive = patch.isActive;
    }
    if (patch.basePrice !== undefined) {
      const nextPrice = new Prisma.Decimal(patch.basePrice);
      if (!current.basePrice.equals(nextPrice)) {
        data.basePrice = nextPrice;
        before.basePrice = current.basePrice.toString();
        after.basePrice = nextPrice.toString();
      }
    }

    const beforeColors: { name: string; stock: number }[] = current.colors.map(
      (color) => ({ name: color.name, stock: color.stock }),
    );

    if (patch.colors !== undefined) {
      for (const incoming of patch.colors) {
        const existingColor = current.colors.find((color) =>
          matchesColorName(color.name, incoming.name),
        );

        if (!existingColor) {
          const created = await tx.color.create({
            data: {
              productId: current.id,
              name: incoming.name,
              stock: incoming.stock,
            },
            select: { id: true },
          });
          if (incoming.stock !== 0) {
            await tx.inventoryLog.create({
              data: {
                colorId: created.id,
                change: incoming.stock,
                reason: InventoryReason.ADJUSTMENT,
                note: ADJUSTMENT_NOTE_PATCH,
              },
            });
          }
          continue;
        }

        const delta = incoming.stock - existingColor.stock;
        if (delta === 0) continue;

        const updated = await tx.color.updateMany({
          where: { id: existingColor.id, stock: { gte: -delta } },
          data: { stock: { increment: delta } },
        });
        if (updated.count !== 1) {
          throw new StockConflictError();
        }
        await tx.inventoryLog.create({
          data: {
            colorId: existingColor.id,
            change: delta,
            reason: InventoryReason.ADJUSTMENT,
            note: ADJUSTMENT_NOTE_PATCH,
          },
        });
      }

      const afterColors = await tx.color.findMany({
        where: { productId: current.id },
        orderBy: { name: "asc" },
        select: { name: true, stock: true },
      });
      const changed =
        afterColors.length !== beforeColors.length ||
        afterColors.some(
          (color, index) =>
            beforeColors[index]?.name !== color.name ||
            beforeColors[index]?.stock !== color.stock,
        );
      if (changed) {
        before.colors = beforeColors;
        after.colors = afterColors;
      }
    }

    if (Object.keys(data).length > 0) {
      await tx.product.update({ where: { id: current.id }, data });
    }

    if (Object.keys(before).length > 0) {
      await tx.adminLog.create({
        data: {
          adminId,
          action: PRODUCT_UPDATE_ACTION,
          entity: PRODUCT_ENTITY,
          entityId: current.id,
          meta: { before, after },
        },
      });
    }

    const saved = await tx.product.findUnique({
      where: { id: current.id },
      select: ADMIN_PRODUCT_SELECT,
    });
    if (!saved) {
      throw new ProductNotFoundError();
    }
    return toAdminProduct(saved);
  });
}

export interface RestockedColor {
  productId: string;
  color: AdminProductColor;
}

export async function restockColor(
  productId: string,
  colorId: string,
  quantity: number,
  adminId: string,
): Promise<RestockedColor> {
  return prisma.$transaction(async (tx) => {
    const color = await tx.color.findUnique({
      where: { id: colorId },
      select: { id: true, productId: true },
    });
    if (!color || color.productId !== productId) {
      throw new ProductNotFoundError();
    }

    const updated = await tx.color.update({
      where: { id: color.id },
      data: { stock: { increment: quantity } },
      select: { id: true, name: true, stock: true },
    });

    await tx.inventoryLog.create({
      data: {
        colorId: color.id,
        change: quantity,
        reason: InventoryReason.RESTOCK,
      },
    });
    await tx.adminLog.create({
      data: {
        adminId,
        action: COLOR_RESTOCK_ACTION,
        entity: COLOR_ENTITY,
        entityId: color.id,
        meta: { productId, quantity },
      },
    });

    return { productId, color: updated };
  });
}
