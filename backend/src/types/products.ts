export type ProductResponse = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  colors: string[];
  image: string | null;
  soldOut: boolean;
};

export type AvailabilityStatus = "ok" | "insufficient" | "unavailable";

export type ProductAvailabilityLine = {
  productId: string;
  color: string;
  quantity: number;
  unitPrice: string;
  available: number;
  status: AvailabilityStatus;
};