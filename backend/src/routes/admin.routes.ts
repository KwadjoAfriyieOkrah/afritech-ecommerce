import { Role } from "@prisma/client";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
  json,
} from "express";
import multer from "multer";

import {
  addProductImageHandler,
  bulkImportProductsHandler,
  createProductHandler,
  listAllProductsHandler,
  restockColorHandler,
  updateProductHandler,
} from "../controllers/admin-products.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

// Only these two routes raise the body limit; express.json() keeps the global
// default everywhere else.
const IMAGE_ROUTE_BODY_LIMIT = "6mb";
const CSV_ROUTE_BODY_LIMIT = "3mb";
const IMAGE_FILE_LIMIT_BYTES = 5 * 1024 * 1024;
const CSV_FILE_LIMIT_BYTES = 2 * 1024 * 1024;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_FILE_LIMIT_BYTES, files: 1 },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_FILE_LIMIT_BYTES, files: 1 },
});

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === code;
}

interface UploadMessages {
  tooLarge: string;
  invalid: string;
}

function singleUpload(
  upload: ReturnType<typeof multer>,
  field: string,
  messages: UploadMessages,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req, res, (error: unknown) => {
      if (error) {
        res.status(400).json({
          error: hasErrorCode(error, "LIMIT_FILE_SIZE")
            ? messages.tooLarge
            : messages.invalid,
        });
        return;
      }
      next();
    });
  };
}

const router = Router();

router.use(requireAuth);
router.use(requireRole(Role.ADMIN));

router.get("/fulfillment/queue", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

router.post(
  "/products/:id/images",
  json({ limit: IMAGE_ROUTE_BODY_LIMIT }),
  singleUpload(imageUpload, "image", {
    tooLarge: `Image must be ${IMAGE_FILE_LIMIT_BYTES / (1024 * 1024)} MB or smaller`,
    invalid: "Invalid image upload",
  }),
  addProductImageHandler,
);

router.post(
  "/products/bulk",
  json({ limit: CSV_ROUTE_BODY_LIMIT }),
  singleUpload(csvUpload, "file", {
    tooLarge: `CSV must be ${CSV_FILE_LIMIT_BYTES / (1024 * 1024)} MB or smaller`,
    invalid: "Invalid CSV upload",
  }),
  bulkImportProductsHandler,
);

router.get("/products", listAllProductsHandler);

router.post("/products", createProductHandler);

router.patch("/products/:id", updateProductHandler);

router.post(
  "/products/:id/colors/:colorId/restock",
  restockColorHandler,
);

export default router;
