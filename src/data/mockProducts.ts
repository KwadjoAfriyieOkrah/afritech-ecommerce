import type { Product } from '@/types';

/**
 * Hardcoded catalogue used when no backend is reachable, so the storefront and
 * the checkout flow can be exercised end to end during development.
 * Prices are in cedis, matching the live API.
 */
export const MOCK_PRODUCTS: Product[] = [
  {
    id: 'mock-1',
    name: 'Afritech Pulse Wireless Earbuds',
    price: 249.99,
    colors: ['Black', 'White', 'Navy'],
    specs: { 'Battery life': '24 hours', 'Water resistance': 'IPX5', 'Bluetooth': '5.3' },
    stock: 18,
    category: 'Audio',
    image: '',
    description: 'Bass-forward true wireless earbuds with a pocketable charging case.'
  },
  {
    id: 'mock-2',
    name: 'Afritech Volt 20000mAh Power Bank',
    price: 185.5,
    colors: ['Black', 'Blue'],
    specs: { Capacity: '20000mAh', Ports: '2x USB-A, 1x USB-C', 'Output': '22.5W max' },
    stock: 32,
    category: 'Power',
    image: '',
    description: 'Fast-charging power bank with an LED capacity display.'
  },
  {
    id: 'mock-3',
    name: 'Afritech Halo Smart Watch',
    price: 649,
    colors: ['Black', 'Rose Gold'],
    specs: { Display: '1.43" AMOLED', Battery: '7 days', Sensors: 'Heart rate, SpO2' },
    stock: 9,
    category: 'Wearables',
    image: '',
    description: 'Fitness-focused smartwatch with call notifications and sleep tracking.'
  },
  {
    id: 'mock-4',
    name: 'Afritech Beam Bluetooth Speaker',
    price: 420,
    colors: ['Charcoal', 'Sand'],
    specs: { Output: '30W', 'Battery life': '12 hours', 'Water resistance': 'IPX7' },
    stock: 4,
    category: 'Audio',
    image: '',
    description: 'Portable speaker with passive bass radiators and stereo pairing.'
  },
  {
    id: 'mock-5',
    name: 'Afritech USB-C 65W GaN Charger',
    price: 310,
    colors: ['White'],
    specs: { Output: '65W', Ports: '2x USB-C, 1x USB-A', Technology: 'GaN' },
    stock: 0,
    category: 'Power',
    image: '',
    description: 'Compact GaN charger that replaces a three-port brick.'
  }
];
