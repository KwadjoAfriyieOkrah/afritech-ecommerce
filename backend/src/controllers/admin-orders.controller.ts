import type { FulfillmentStatus } from "../generated/prisma/client";
import type { Request, Response } from "express";
import type { ZodError } from "zod";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import {
  AdminRiderNotFoundError,
  OrderTransitionConflictError,
  RiderInactiveError,
  assignRider,
  createRider,
  dispatchOrder,
  getOrderForAdmin,
  listActiveRiders,
  listOrdersForAdmin,
  markOrderDelivered,
  moveOrderToPackaging,
} from "../services/admin-orders.service";
import {
  adminFulfillmentQuerySchema,
  adminOrderIdSchema,
  adminRiderAssignSchema,
  adminRiderCreateSchema,
  toAdminValidationDetails,
} from "../validation/admin-orders.schemas";

const ORDER_NOT_FOUND_BODY: { error: string } = { error: "Order not found" };
const RIDER_NOT_FOUND_BODY: { error: string } = { error: "Rider not found" };
const RIDER_INACTIVE_BODY: { error: string } = { error: "Rider is not active" };
const OK_BODY: { status: string } = { status: "ok" };

function validationBody(error: ZodError): { error: string } {
  const detail = toAdminValidationDetails(error)[0] ?? {
    field: "body",
    message: "Invalid request body",
  };
  return { error: `${detail.field}: ${detail.message}` };
}

function readOrderId(req: Request): string | null {
  const parsed = adminOrderIdSchema.safeParse(req.params.id);
  return parsed.success ? parsed.data : null;
}

function sendMutationError(error: unknown, res: Response): boolean {
  if (error instanceof OrderTransitionConflictError) {
    res.status(409).json({ error: error.message });
    return true;
  }
  if (error instanceof AdminRiderNotFoundError) {
    res.status(404).json(RIDER_NOT_FOUND_BODY);
    return true;
  }
  if (error instanceof RiderInactiveError) {
    res.status(409).json(RIDER_INACTIVE_BODY);
    return true;
  }
  return false;
}

export async function listAdminOrdersHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  let fulfillment: FulfillmentStatus | undefined;
  if (req.query.fulfillment !== undefined) {
    const parsed = adminFulfillmentQuerySchema.safeParse(
      req.query.fulfillment,
    );
    if (!parsed.success) {
      res.status(400).json({
        error:
          "fulfillment: Fulfillment must be PENDING, PACKAGING, DISPATCHED or DELIVERED",
      });
      return;
    }
    fulfillment = parsed.data;
  }

  try {
    const orders = await listOrdersForAdmin(fulfillment);
    res.status(200).json(orders);
  } catch (error) {
    console.error("Failed to list admin orders:", error);
    res.status(500).json({ error: "Could not load orders" });
  }
}

export async function getAdminOrderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const idResult = adminOrderIdSchema.safeParse(req.params.id);
  if (!idResult.success) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    const order = await getOrderForAdmin(idResult.data);
    if (!order) {
      res.status(404).json(ORDER_NOT_FOUND_BODY);
      return;
    }
    res.status(200).json(order);
  } catch (error) {
    console.error("Failed to load admin order:", error);
    res.status(500).json({ error: "Could not load order" });
  }
}

export async function listAdminRidersHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const riders = await listActiveRiders();
    res.status(200).json(riders);
  } catch (error) {
    console.error("Failed to list admin riders:", error);
    res.status(500).json({ error: "Could not load riders" });
  }
}

export async function createAdminRiderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const parsed = adminRiderCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationBody(parsed.error));
    return;
  }

  try {
    const rider = await createRider(parsed.data, user.id);
    res.status(201).json(rider);
  } catch (error) {
    console.error("Failed to create rider:", error);
    res.status(500).json({ error: "Could not create rider" });
  }
}

export async function assignRiderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const parsed = adminRiderAssignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationBody(parsed.error));
    return;
  }

  const orderId = readOrderId(req);
  if (!orderId) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    await assignRider(orderId, parsed.data.riderId, user.id);
    res.status(200).json(OK_BODY);
  } catch (error) {
    if (sendMutationError(error, res)) return;
    console.error("Failed to assign rider:", error);
    res.status(500).json({ error: "Could not assign rider" });
  }
}

export async function moveToPackagingHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const orderId = readOrderId(req);
  if (!orderId) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    await moveOrderToPackaging(orderId, user.id);
    res.status(200).json(OK_BODY);
  } catch (error) {
    if (sendMutationError(error, res)) return;
    console.error("Failed to move order to packaging:", error);
    res.status(500).json({ error: "Could not update order" });
  }
}

export async function dispatchOrderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const orderId = readOrderId(req);
  if (!orderId) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    await dispatchOrder(orderId, user.id);
    res.status(200).json(OK_BODY);
  } catch (error) {
    if (sendMutationError(error, res)) return;
    console.error("Failed to dispatch order:", error);
    res.status(500).json({ error: "Could not update order" });
  }
}

export async function markDeliveredHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const orderId = readOrderId(req);
  if (!orderId) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    await markOrderDelivered(orderId, user.id);
    res.status(200).json(OK_BODY);
  } catch (error) {
    if (sendMutationError(error, res)) return;
    console.error("Failed to mark order delivered:", error);
    res.status(500).json({ error: "Could not update order" });
  }
}
