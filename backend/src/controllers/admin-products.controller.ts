import type { Request, Response } from "express";
import type { ZodError } from "zod";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import {
  CsvParseError,
  ImageLimitError,
  ProductNotFoundError,
  SpecValidationError,
  StockConflictError,
  UnsupportedImageError,
  addProductImage,
  createProduct,
  getAdminSalesSummary,
  listAllProducts,
  parseProductCsv,
  removeProductImage,
  restockColor,
  runBulkProductImport,
  updateProduct,
  type BulkImportResult,
  type CsvRow,
} from "../services/admin-products.service";
import {
  MAX_BULK_ROWS,
  MAX_PRODUCT_IMAGES,
  productIdSchema,
  productInputSchema,
  productPatchSchema,
  restockInputSchema,
  toProductValidationDetails,
  type ValidationDetail,
} from "../validation/products.schemas";

// Single source for the not-found body. An unknown id, a malformed id and any
// other miss path send this exact object so the responses stay identical.
const PRODUCT_NOT_FOUND_BODY: { error: string } = { error: "Product not found" };

const IMAGE_FILE_REQUIRED_BODY: { error: string } = {
  error: 'Provide one image file in the "image" field',
};
const CSV_FILE_REQUIRED_BODY: { error: string } = {
  error: 'Provide one CSV file in the "file" field',
};
const IMAGE_FORMAT_BODY: { error: string } = {
  error: "Only JPEG, PNG or WebP images are allowed",
};

function readMember(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  if (Array.isArray(value)) {
    return isTruthyFlag(value[0]);
  }
  return false;
}

function readConfirm(req: Request): boolean {
  const fromBody: unknown = readMember(req.body, "confirm");
  const source: unknown =
    fromBody !== undefined ? fromBody : readMember(req.query, "confirm");
  return isTruthyFlag(source);
}

export async function addProductImageHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const idResult = productIdSchema.safeParse(req.params.id);
  if (!idResult.success) {
    res.status(404).json(PRODUCT_NOT_FOUND_BODY);
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json(IMAGE_FILE_REQUIRED_BODY);
    return;
  }

  try {
    const result = await addProductImage({
      productId: idResult.data,
      adminId: user.id,
      buffer: file.buffer,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      res.status(400).json(IMAGE_FORMAT_BODY);
      return;
    }
    if (error instanceof ProductNotFoundError) {
      res.status(404).json(PRODUCT_NOT_FOUND_BODY);
      return;
    }
    if (error instanceof ImageLimitError) {
      res.status(400).json({
        error: `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
      });
      return;
    }
    console.error("Failed to add product image:", error);
    res.status(500).json({ error: "Could not store the image" });
  }
}

export async function removeProductImageHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const idResult = productIdSchema.safeParse(req.params.id);
  const rawIndex = req.params.index;
  if (
    !idResult.success ||
    typeof rawIndex !== "string" ||
    !/^\d+$/.test(rawIndex)
  ) {
    res.status(404).json(PRODUCT_NOT_FOUND_BODY);
    return;
  }
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index)) {
    res.status(404).json(PRODUCT_NOT_FOUND_BODY);
    return;
  }

  try {
    const result = await removeProductImage({
      productId: idResult.data,
      index,
      adminId: user.id,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      res.status(404).json(PRODUCT_NOT_FOUND_BODY);
      return;
    }
    console.error("Failed to remove product image:", error);
    res.status(500).json({ error: "Could not remove the image" });
  }
}

function bulkResponseBody(result: BulkImportResult): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mode: result.mode,
    committed: result.committed,
    summary: result.summary,
    errors: result.errors,
  };
  if (result.errors.length > 0) {
    body.error = "Validation failed";
  }
  return body;
}

export async function bulkImportProductsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json(CSV_FILE_REQUIRED_BODY);
    return;
  }

  let rows: CsvRow[];
  try {
    rows = parseProductCsv(file.buffer.toString("utf8"));
  } catch (error) {
    if (error instanceof CsvParseError) {
      res.status(400).json({ error: "Could not parse the CSV file" });
      return;
    }
    console.error("Failed to read the CSV upload:", error);
    res.status(500).json({ error: "Could not import products" });
    return;
  }

  if (rows.length === 0) {
    res.status(400).json({ error: "The CSV file has no data rows" });
    return;
  }
  if (rows.length > MAX_BULK_ROWS) {
    res.status(400).json({
      error: `The CSV file may contain at most ${MAX_BULK_ROWS} rows`,
    });
    return;
  }

  try {
    const result = await runBulkProductImport({
      adminId: user.id,
      rows,
      confirm: readConfirm(req),
    });
    const status = result.errors.length > 0 ? 400 : 200;
    res.status(status).json(bulkResponseBody(result));
  } catch (error) {
    console.error("Bulk product import failed:", error);
    res.status(500).json({ error: "Could not import products" });
  }
}

function validationBody(error: ZodError): { error: string } {
  const details = toProductValidationDetails(error);
  const detail: ValidationDetail = details[0] ?? {
    field: "body",
    message: "Invalid request body",
  };
  const field = detail.field === "row" ? "body" : detail.field;
  return { error: `${field}: ${detail.message}` };
}

export async function listAllProductsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const products = await listAllProducts();
    res.status(200).json(products);
  } catch (error) {
    console.error("Failed to list admin products:", error);
    res.status(500).json({ error: "Could not load products" });
  }
}

const DEFAULT_SALES_DAYS = 30;
const MAX_SALES_DAYS = 365;

function readSalesDays(value: unknown): number | null {
  let raw: unknown = value;
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (raw === undefined) return DEFAULT_SALES_DAYS;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_SALES_DAYS;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed > MAX_SALES_DAYS ? MAX_SALES_DAYS : parsed;
}

export async function getSalesSummaryHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const days = readSalesDays(req.query.days);
  if (days === null) {
    res.status(400).json({ error: "days must be a positive integer" });
    return;
  }

  try {
    const summary = await getAdminSalesSummary(days);
    res.status(200).json(summary);
  } catch (error) {
    console.error("Failed to load sales summary:", error);
    res.status(500).json({ error: "Could not load sales" });
  }
}

export async function createProductHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const parsed = productInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationBody(parsed.error));
    return;
  }

  try {
    const product = await createProduct(parsed.data, user.id);
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof SpecValidationError) {
      res.status(400).json({ error: `${error.field}: ${error.message}` });
      return;
    }
    if (error instanceof ProductNotFoundError) {
      res.status(404).json(PRODUCT_NOT_FOUND_BODY);
      return;
    }
    console.error("Failed to create product:", error);
    res.status(500).json({ error: "Could not create the product" });
  }
}

export async function updateProductHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const idResult = productIdSchema.safeParse(req.params.id);
  if (!idResult.success) {
    res.status(404).json(PRODUCT_NOT_FOUND_BODY);
    return;
  }

  const parsed = productPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationBody(parsed.error));
    return;
  }

  try {
    const product = await updateProduct(idResult.data, parsed.data, user.id);
    res.status(200).json(product);
  } catch (error) {
    if (error instanceof SpecValidationError) {
      res.status(400).json({ error: `${error.field}: ${error.message}` });
      return;
    }
    if (error instanceof ProductNotFoundError) {
      res.status(404).json(PRODUCT_NOT_FOUND_BODY);
      return;
    }
    if (error instanceof StockConflictError) {
      res.status(400).json({
        error: "colors: Stock changed while updating, send the request again",
      });
      return;
    }
    console.error("Failed to update product:", error);
    res.status(500).json({ error: "Could not update the product" });
  }
}

export async function restockColorHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const idResult = productIdSchema.safeParse(req.params.id);
  const colorResult = productIdSchema.safeParse(req.params.colorId);
  if (!idResult.success || !colorResult.success) {
    res.status(404).json(PRODUCT_NOT_FOUND_BODY);
    return;
  }

  const parsed = restockInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationBody(parsed.error));
    return;
  }

  try {
    const result = await restockColor(
      idResult.data,
      colorResult.data,
      parsed.data.quantity,
      user.id,
    );
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      res.status(404).json(PRODUCT_NOT_FOUND_BODY);
      return;
    }
    console.error("Failed to restock colour:", error);
    res.status(500).json({ error: "Could not restock the colour" });
  }
}
