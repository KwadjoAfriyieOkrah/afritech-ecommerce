import { ProductCategory } from "../generated/prisma/client";
import { z } from "zod";

export const MAX_PRODUCT_IMAGES = 6;
export const MAX_BULK_ROWS = 500;

const MAX_PRODUCT_ID_LENGTH = 64;

// Two decimal places and at most eight integer digits, matching
// Product.basePrice @db.Decimal(10, 2). Rejects negatives and exponents.
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;

// "0", "0.00", "0.0" and nothing else: any non-zero digit survives.
const ZERO_PRICE_PATTERN = /^0+(\.0+)?$/;

export const productIdSchema = z
  .string()
  .min(1, "Product not found")
  .max(MAX_PRODUCT_ID_LENGTH, "Product not found");

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name must be at least 1 character")
  .max(120, "Name must be at most 120 characters");

const brandSchema = z
  .string()
  .trim()
  .min(1, "Brand is required")
  .max(60, "Brand must be at most 60 characters");

const categorySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z.enum(ProductCategory, {
      error: "Category must be iPhone, Samsung or Laptop",
    }),
  );

const descriptionSchema = z
  .string()
  .trim()
  .max(1000, "Description must be at most 1000 characters");

const basePriceSchema = z
  .union([z.number(), z.string().trim()])
  .refine(
    (value) =>
      typeof value === "number"
        ? Number.isFinite(value) && DECIMAL_PATTERN.test(String(value))
        : DECIMAL_PATTERN.test(value),
    "Enter a valid price with at most 2 decimal places",
  )
  .transform((value) => (typeof value === "number" ? String(value) : value))
  .refine(
    (value) => !ZERO_PRICE_PATTERN.test(value),
    "Price must be greater than 0",
  );

const iphoneStorageSchema = z.enum(["128GB", "256GB", "512GB", "1TB"]);
const laptopStorageSchema = z.enum(["256GB", "512GB", "1TB", "2TB"]);
const samsungRamSchema = z.enum(["4GB", "6GB", "8GB", "12GB", "16GB"]);
const laptopRamSchema = z.enum([
  "4GB",
  "8GB",
  "12GB",
  "16GB",
  "24GB",
  "32GB",
  "64GB",
]);

function specText(maxLength: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1, "This field is required")
    .max(maxLength, `Must be at most ${maxLength} characters`);
}

const iphoneSpecFields = z.object({
  storage: iphoneStorageSchema,
  colour: specText(40),
  chip: specText(60),
  camera: specText(120),
  screenSize: specText(20),
  battery: specText(60),
});

const samsungSpecFields = z.object({
  storage: iphoneStorageSchema,
  colour: specText(40),
  ram: samsungRamSchema,
  camera: specText(120),
  screenSize: specText(20),
  battery: specText(60),
});

const laptopSpecFields = z.object({
  colour: specText(40),
  processor: specText(80),
  ram: laptopRamSchema,
  storage: laptopStorageSchema,
  screenSize: specText(20),
  graphics: specText(80),
  batteryLife: specText(40),
});

const iphoneSpecsSchema = iphoneSpecFields.strict();
const samsungSpecsSchema = samsungSpecFields.strict();
const laptopSpecsSchema = laptopSpecFields.strict();

export type ProductSpecs =
  | z.infer<typeof iphoneSpecsSchema>
  | z.infer<typeof samsungSpecsSchema>
  | z.infer<typeof laptopSpecsSchema>;

export type SpecValidationResult =
  | { success: true; data: ProductSpecs | null }
  | { success: false; field: string; message: string };

export type PartialSpecValidationResult =
  | { success: true; data: Partial<ProductSpecs> | null }
  | { success: false; field: string; message: string };

const SPEC_SCHEMAS: Record<ProductCategory, z.ZodType<ProductSpecs>> = {
  [ProductCategory.IPHONE]: iphoneSpecsSchema,
  [ProductCategory.SAMSUNG]: samsungSpecsSchema,
  [ProductCategory.LAPTOP]: laptopSpecsSchema,
};

const PARTIAL_SPEC_SCHEMAS: Record<
  ProductCategory,
  z.ZodType<Partial<ProductSpecs>>
> = {
  [ProductCategory.IPHONE]: iphoneSpecFields.partial().strict(),
  [ProductCategory.SAMSUNG]: samsungSpecFields.partial().strict(),
  [ProductCategory.LAPTOP]: laptopSpecFields.partial().strict(),
};

export function validateSpecs(
  category: ProductCategory,
  specs: unknown,
): SpecValidationResult;
export function validateSpecs(
  category: ProductCategory,
  specs: unknown,
  allowPartial: true,
): PartialSpecValidationResult;
export function validateSpecs(
  category: ProductCategory,
  specs: unknown,
  allowPartial = false,
): SpecValidationResult | PartialSpecValidationResult {
  if (specs === null) {
    return { success: true, data: null };
  }

  const parsed = allowPartial
    ? PARTIAL_SPEC_SCHEMAS[category].safeParse(specs)
    : SPEC_SCHEMAS[category].safeParse(specs);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    let field = "specs";
    if (issue?.code === "unrecognized_keys" && issue.keys.length > 0) {
      field = issue.keys[0] ?? "specs";
    } else if (issue && issue.path.length > 0) {
      field = issue.path.map(String).join(".");
    }
    return {
      success: false,
      field,
      message: issue?.message ?? "Invalid specs",
    };
  }

  return { success: true, data: parsed.data };
}

const isActiveSchema = z.union([
  z.boolean(),
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const lowered = value.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
      ctx.addIssue({ code: "custom", message: "isActive must be true or false" });
      return z.NEVER;
    }),
]);

const colorEntrySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Colour name is required")
    .max(40, "Colour name must be at most 40 characters"),
  stock: z
    .number()
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative"),
});

export const colorCreateSchema = colorEntrySchema;

// Accepts both shapes the single-product routes and the bulk CSV produce:
// [{ name, stock }] or the CSV cell "Name:stock|Name:stock".
const colorsSchema = z
  .union([
    z.array(colorEntrySchema),
    z.string().transform((raw, ctx) => {
      if (raw.trim() === "") {
        ctx.addIssue({ code: "custom", message: "Add at least one colour" });
        return z.NEVER;
      }

      const entries: { name: string; stock: number }[] = [];
      const parts = raw.split("|");
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? "";
        const separator = part.indexOf(":");
        if (separator === -1) {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: 'Use the format "Name:stock|Name:stock"',
          });
          continue;
        }

        const name = part.slice(0, separator).trim();
        const stockText = part.slice(separator + 1).trim();
        const stock = Number(stockText);
        if (name === "") {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: "Colour name is required",
          });
          continue;
        }
        if (
          stockText === "" ||
          !Number.isInteger(stock) ||
          Number.isNaN(stock) ||
          stock < 0
        ) {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: "Stock must be a whole number of 0 or more",
          });
          continue;
        }
        entries.push({ name, stock });
      }
      return entries;
    }),
  ])
  .pipe(
    z
      .array(colorEntrySchema)
      .min(1, "Add at least one colour")
      .max(10, "A product can have at most 10 colours"),
  )
  .superRefine((colors, ctx) => {
    const seen = new Set<string>();
    colors.forEach((color, index) => {
      const key = color.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Duplicate colour name",
        });
      }
      seen.add(key);
    });
  });

const productFields = {
  name: nameSchema,
  brand: brandSchema,
  category: categorySchema,
  description: descriptionSchema.optional(),
  basePrice: basePriceSchema,
  isActive: isActiveSchema.optional(),
  colors: colorsSchema,
};

const csvSpecValueSchema = z.string().trim().optional();

// One field set drives both the single-product routes and every bulk row, so
// a row can never be accepted under weaker rules than a single write.
export const productInputSchema = z
  .object({
    ...productFields,
    colors: colorsSchema.optional(),
    specs: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.colors === undefined) return;

    const specs = value.specs;
    if (typeof specs !== "object" || specs === null || Array.isArray(specs)) {
      return;
    }

    const colour = Reflect.get(specs, "colour");
    if (typeof colour !== "string") return;

    value.colors.forEach((color, index) => {
      if (color.name !== colour) {
        ctx.addIssue({
          code: "custom",
          path: ["colors", index, "name"],
          message: `Colour name must match the spec colour "${colour}"`,
        });
      }
    });
  });

export const bulkProductRowSchema = z.object({
  id: productIdSchema.optional(),
  ...productFields,
  storage: csvSpecValueSchema,
  ram: csvSpecValueSchema,
  chip: csvSpecValueSchema,
  camera: csvSpecValueSchema,
  screenSize: csvSpecValueSchema,
  battery: csvSpecValueSchema,
  processor: csvSpecValueSchema,
  graphics: csvSpecValueSchema,
  batteryLife: csvSpecValueSchema,
  colour: csvSpecValueSchema,
});

// A patch may touch any subset of the product fields but an empty body would
// silently do nothing, so at least one recognised field is required.
export const productPatchSchema = z
  .object({
    name: nameSchema.optional(),
    brand: brandSchema.optional(),
    category: categorySchema.optional(),
    description: descriptionSchema.optional(),
    basePrice: basePriceSchema.optional(),
    isActive: isActiveSchema.optional(),
    colors: colorsSchema.optional(),
    specs: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one field to update",
      });
    }
  });

export const restockInputSchema = z.object({
  quantity: z
    .number()
    .int("quantity must be a whole number")
    .positive("quantity must be greater than 0"),
});

const availabilityLineSchema = z
  .object({
    productId: productIdSchema,
    color: z.string().trim().min(1, "Colour is required"),
    quantity: z
      .number()
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(10, "Quantity must be at most 10"),
  })
  .strict();

// Read-only price and stock probe used before checkout. It never writes or
// reserves anything; POST /orders remains the authority.
export const productAvailabilitySchema = z
  .object({
    items: z
      .array(availabilityLineSchema)
      .min(1, "Add at least one item")
      .max(50, "You can check at most 50 items"),
  })
  .strict();

export type ProductInput = z.infer<typeof productInputSchema>;
export type ColorCreateInput = z.infer<typeof colorCreateSchema>;
export type BulkProductRow = z.infer<typeof bulkProductRowSchema>;
export type ProductPatch = z.infer<typeof productPatchSchema>;
export type RestockInput = z.infer<typeof restockInputSchema>;
export type ProductAvailabilityInput = z.infer<typeof productAvailabilitySchema>;
export type AvailabilityLineInput = z.infer<typeof availabilityLineSchema>;

export interface ValidationDetail {
  field: string;
  message: string;
}

export function toProductValidationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : "row",
    message: issue.message,
  }));
}
