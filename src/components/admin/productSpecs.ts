import type { AdminProductCategory } from '@/services/adminApi';

export interface ProductSpecField {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: readonly string[];
  maxLength?: number;
  placeholder?: string;
}

export const PRODUCT_CATEGORIES: ReadonlyArray<{
  value: AdminProductCategory;
  label: string;
}> = [
  { value: 'IPHONE', label: 'iPhone' },
  { value: 'SAMSUNG', label: 'Samsung' },
  { value: 'LAPTOP', label: 'Laptop' }
];

const IPHONE_STORAGE: readonly string[] = ['128GB', '256GB', '512GB', '1TB'];
const LAPTOP_STORAGE: readonly string[] = ['256GB', '512GB', '1TB', '2TB'];
const SAMSUNG_RAM_OPTIONS: readonly string[] = [
  '4GB',
  '6GB',
  '8GB',
  '12GB',
  '16GB'
];
const LAPTOP_RAM_OPTIONS: readonly string[] = [
  '4GB',
  '8GB',
  '12GB',
  '16GB',
  '24GB',
  '32GB',
  '64GB'
];

export const PRODUCT_SPECS: Record<
  AdminProductCategory,
  readonly ProductSpecField[]
> = {
  IPHONE: [
    {
      key: 'storage',
      label: 'Storage',
      type: 'select',
      options: IPHONE_STORAGE
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'text',
      maxLength: 40,
      placeholder: 'Deep Purple'
    },
    {
      key: 'chip',
      label: 'Chip',
      type: 'text',
      maxLength: 60,
      placeholder: 'A17 Pro'
    },
    {
      key: 'camera',
      label: 'Camera',
      type: 'text',
      maxLength: 120,
      placeholder: '48MP wide camera'
    },
    {
      key: 'screenSize',
      label: 'Screen size',
      type: 'text',
      maxLength: 20,
      placeholder: '6.1 inch'
    },
    {
      key: 'battery',
      label: 'Battery',
      type: 'text',
      maxLength: 60,
      placeholder: 'Up to 23 hours'
    }
  ],
  SAMSUNG: [
    {
      key: 'storage',
      label: 'Storage',
      type: 'select',
      options: IPHONE_STORAGE
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'text',
      maxLength: 40,
      placeholder: 'Phantom Black'
    },
    {
      key: 'ram',
      label: 'RAM',
      type: 'select',
      options: SAMSUNG_RAM_OPTIONS
    },
    {
      key: 'camera',
      label: 'Camera',
      type: 'text',
      maxLength: 120,
      placeholder: '50MP wide camera'
    },
    {
      key: 'screenSize',
      label: 'Screen size',
      type: 'text',
      maxLength: 20,
      placeholder: '6.2 inch'
    },
    {
      key: 'battery',
      label: 'Battery',
      type: 'text',
      maxLength: 60,
      placeholder: '5000mAh'
    }
  ],
  LAPTOP: [
    {
      key: 'processor',
      label: 'Processor',
      type: 'text',
      maxLength: 80,
      placeholder: 'Intel Core i7'
    },
    {
      key: 'ram',
      label: 'RAM',
      type: 'select',
      options: LAPTOP_RAM_OPTIONS
    },
    {
      key: 'storage',
      label: 'Storage',
      type: 'select',
      options: LAPTOP_STORAGE
    },
    {
      key: 'screenSize',
      label: 'Screen size',
      type: 'text',
      maxLength: 20,
      placeholder: '14 inch'
    },
    {
      key: 'graphics',
      label: 'Graphics',
      type: 'text',
      maxLength: 80,
      placeholder: 'Integrated graphics'
    },
    {
      key: 'batteryLife',
      label: 'Battery life',
      type: 'text',
      maxLength: 40,
      placeholder: 'Up to 12 hours'
    }
  ]
};
