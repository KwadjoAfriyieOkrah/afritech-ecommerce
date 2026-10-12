-- AlterTable
-- Convert the existing text column to the ProductCategory enum in place instead
-- of dropping and recreating it, so existing rows (IPHONE, SAMSUNG) are preserved.
ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "ProductCategory"
  USING ("category"::"ProductCategory");
