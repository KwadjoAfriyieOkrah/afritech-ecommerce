import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Sign in | AFriTech',
  description: 'Sign in to view your order history and speed through checkout.'
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
