import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Create account | AFriTech',
  description: 'Create an AFriTech account to track orders and save your delivery details.'
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
