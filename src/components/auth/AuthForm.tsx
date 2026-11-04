'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HiOutlineExclamation, HiOutlineEye, HiOutlineEyeOff } from 'react-icons/hi';
import { toast } from 'sonner';
import { ApiError, loginUser, registerUser, setAuthToken } from '@/services/api';
import { useUserStore } from '@/store';
import type { DeliveryInfo, User } from '@/types';
import {
  passwordPolicyHint,
  validateEmail,
  validatePassword,
  validatePhoneGH
} from '@/utils/validators';

type Mode = 'login' | 'register';

type FieldName = 'name' | 'email' | 'phone' | 'password';

type FieldErrors = Partial<Record<FieldName, string>>;

interface FormFields {
  name: string;
  email: string;
  phone: string;
  password: string;
}

const EMPTY_FIELDS: FormFields = { name: '', email: '', phone: '', password: '' };

const ERROR_CLASS = 'border-red-400 focus:border-red-500';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-xs font-medium text-red-600">
      <HiOutlineExclamation className="mt-px h-3.5 w-3.5 flex-none" aria-hidden="true" />
      {message}
    </p>
  );
}

interface AuthFormProps {
  mode: Mode;
  onSuccess?: (user: User) => void;
  onSwitchMode?: () => void;
}

export function AuthForm({ mode, onSuccess, onSwitchMode }: AuthFormProps) {
  const router = useRouter();

  const user = useUserStore((state) => state.user);
  const sessionReady = useUserStore((state) => state.sessionReady);
  const setUser = useUserStore((state) => state.setUser);
  const deliveryInfo = useUserStore((state) => state.deliveryInfo);
  const updateDeliveryInfo = useUserStore((state) => state.updateDeliveryInfo);

  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const isRegister = mode === 'register';

  // Already signed in: the standalone auth pages have nothing to do, so go to
  // the account page. Embedded callers (onSuccess provided) handle this
  // themselves and must not be redirected away from the current step.
  useEffect(() => {
    if (sessionReady && user && !onSuccess) router.replace('/account');
  }, [sessionReady, user, router, onSuccess]);

  const setField = (name: FieldName, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setFormError(null);
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};

    if (!validateEmail(fields.email)) {
      next.email = 'Enter a valid email, e.g. you@example.com';
    }

    if (isRegister) {
      if (fields.name.trim().length < 2) {
        next.name = 'Enter your full name (at least 2 characters)';
      }
      if (!validatePhoneGH(fields.phone)) {
        next.phone = 'Enter a valid Ghana number, e.g. 0241234567';
      }
      if (!validatePassword(fields.password)) {
        next.password = passwordPolicyHint();
      }
    } else if (!fields.password) {
      next.password = 'Enter your password';
    }

    return next;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Guards against a double-click creating two accounts or two sessions.
    if (isSubmitting) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const auth = isRegister
          ? await registerUser({
              name: fields.name.trim(),
              email: fields.email.trim(),
              phone: fields.phone.trim(),
              password: fields.password
            })
          : await loginUser({ email: fields.email.trim(), password: fields.password });

        if (auth.token) setAuthToken(auth.token);
        setUser(auth.user);

        // Seed an empty checkout draft from the profile, never overwriting
        // anything the visitor already typed before signing in.
        const seed: Partial<DeliveryInfo> = {};
        if (!deliveryInfo.customerName.trim()) seed.customerName = auth.user.name;
        if (!deliveryInfo.customerEmail.trim()) seed.customerEmail = auth.user.email;
        if (!deliveryInfo.customerPhone.trim()) seed.customerPhone = auth.user.phone;
        if (Object.keys(seed).length > 0) updateDeliveryInfo(seed);

        // The password never leaves this component: drop it from state now.
        setFields((current) => ({ ...current, password: '' }));

        toast.success(
          isRegister
            ? `Account created. Welcome, ${auth.user.name.split(' ')[0]}!`
            : `Welcome back, ${auth.user.name.split(' ')[0]}!`
        );

        if (onSuccess) {
          onSuccess(auth.user);
        } else {
          router.replace('/account');
        }
      } catch (caught) {
        setFormError(ApiError.from(caught).message);
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:px-6">
      <div className="card flex flex-col gap-5 p-5 sm:p-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-stone-500">
            {isRegister
              ? 'Save your details once and check your order history any time.'
              : 'Sign in to see your orders and speed through checkout.'}
          </p>
        </div>

        {formError && (
          <div role="alert" aria-live="assertive" className="alert-error">
            <p className="font-semibold">{formError}</p>
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {isRegister && (
            <div>
              <label htmlFor="name" className="label">
                Full name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                maxLength={80}
                className={`input ${errors.name ? ERROR_CLASS : ''}`}
                placeholder="Ama Mensah"
                value={fields.name}
                onChange={(event) => setField('name', event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              <FieldError id="name-error" message={errors.name} />
            </div>
          )}

          <div>
            <label htmlFor="email" className="label">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={254}
              className={`input ${errors.email ? ERROR_CLASS : ''}`}
              placeholder="you@example.com"
              value={fields.email}
              onChange={(event) => setField('email', event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            <FieldError id="email-error" message={errors.email} />
          </div>

          {isRegister && (
            <div>
              <label htmlFor="phone" className="label">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                className={`input ${errors.phone ? ERROR_CLASS : ''}`}
                placeholder="0241234567"
                value={fields.phone}
                onChange={(event) => setField('phone', event.target.value)}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
              />
              <FieldError id="phone-error" message={errors.phone} />
            </div>
          )}

          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                maxLength={128}
                className={`input pr-11 ${errors.password ? ERROR_CLASS : ''}`}
                placeholder={isRegister ? 'At least 8 characters' : 'Your password'}
                value={fields.password}
                onChange={(event) => setField('password', event.target.value)}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password
                    ? 'password-error'
                    : isRegister
                      ? 'password-policy'
                      : undefined
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-stone-500 hover:text-ink"
              >
                {showPassword ? (
                  <HiOutlineEyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <HiOutlineEye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <FieldError id="password-error" message={errors.password} />
            {isRegister && !errors.password && (
              <p id="password-policy" className="mt-1 text-xs text-stone-500">
                {passwordPolicyHint()}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary mt-1 w-full"
          >
            {isSubmitting
              ? 'Please wait...'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-stone-500">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          {onSwitchMode ? (
            <button
              type="button"
              onClick={onSwitchMode}
              className="font-semibold text-dark-gold underline-offset-4 hover:underline"
            >
              {isRegister ? 'Sign in' : 'Create one'}
            </button>
          ) : (
            <Link
              href={isRegister ? '/login' : '/register'}
              className="font-semibold text-dark-gold underline-offset-4 hover:underline"
            >
              {isRegister ? 'Sign in' : 'Create one'}
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
