import { OrderStatus, type TrackingStage, type TrackingStageState } from '@/types';

export const TRACKING_STAGES: readonly TrackingStage[] = [
  {
    status: OrderStatus.PENDING,
    label: 'Pending',
    description: 'We have received your order and payment.'
  },
  {
    status: OrderStatus.PACKAGING,
    label: 'Packaging',
    description: 'Your items are being packed and quality checked.'
  },
  {
    status: OrderStatus.DISPATCHED,
    label: 'Dispatched',
    description: 'Your package is on the way to you.'
  },
  {
    status: OrderStatus.DELIVERED,
    label: 'Delivered',
    description: 'Your package has been handed over.'
  }
];

const STAGE_INDEX_BY_STATUS: ReadonlyMap<OrderStatus, number> = new Map(
  TRACKING_STAGES.map((stage, index) => [stage.status, index])
);

export function trackingStageIndex(status: OrderStatus | string | undefined): number {
  if (!status) return 0;
  return STAGE_INDEX_BY_STATUS.get(status as OrderStatus) ?? 0;
}

export function trackingStageState(
  stageIndex: number,
  currentIndex: number
): TrackingStageState {
  if (stageIndex < currentIndex) return 'completed';
  if (stageIndex === currentIndex) return 'current';
  return 'upcoming';
}

export function isDelivered(status: OrderStatus | string | undefined): boolean {
  return status === OrderStatus.DELIVERED;
}

export function hasRider(
  status: OrderStatus | string | undefined,
  rider: { name?: string; phone?: string } | null | undefined
): rider is { name: string; phone: string; vehicle?: string } {
  return (
    status === OrderStatus.DISPATCHED &&
    Boolean(rider?.name?.trim()) &&
    Boolean(rider?.phone?.trim())
  );
}
