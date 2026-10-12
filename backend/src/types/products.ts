export type ProductResponse = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  colors: string[];
  image: string | null;
};