-- Additive migration: guest order support.
--
-- "Order"."customerEmail" becomes nullable so an order can be placed without
-- an account. Existing rows keep their email, and no row is rewritten.
--
-- "Order"."accessTokenHash" holds the hash of the guest access token used to
-- read that order. It is nullable and empty for every existing row, and the
-- column is added without a default, so no table rewrite happens.
BEGIN;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "customerEmail" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "accessTokenHash" TEXT;

COMMIT;
