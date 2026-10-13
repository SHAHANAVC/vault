'use client';

/**
 * Client Component Directive: "use client"
 * Required for interactive registration form with React Hook Form, state management,
 * and dynamic search query inspection (for partner invitations).
 */

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, RegisterInput } from '@vault/shared';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';

  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: RegisterInput) => {
    setIsLoading(true);
    setServerError(null);

    try {
      const payload: RegisterInput & { inviteToken?: string } = {
        ...data,
      };
      if (inviteToken) {
        payload.inviteToken = inviteToken;
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json.message || 'Registration failed. Please try again.');
        setIsLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch (_err) {
      setServerError('A network error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-radial from-zinc-900 to-zinc-950">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xl mb-3 shadow-lg shadow-emerald-500/5">
            V
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Create your Vault Account
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Private, joint cash-flow management for modern families
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {inviteToken && (
            <div className="mb-6 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2.5 font-medium">
              <svg
                className="w-4 h-4 text-emerald-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>
                Partner invitation active — You will join your partner upon signup
              </span>
            </div>
          )}

          {serverError && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-3">
              <svg
                className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-zinc-300 mb-1.5 uppercase tracking-wider"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Rahul Sharma"
                disabled={isLoading}
                {...register('name')}
                className={`w-full px-4 py-2.5 rounded-xl bg-zinc-950/60 border text-white placeholder-zinc-500 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                  errors.name
                    ? 'border-rose-500/60 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-emerald-500/60'
                }`}
              />
              {errors.name && (
                <p className="mt-1.5 text-xs text-rose-400 font-medium">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-zinc-300 mb-1.5 uppercase tracking-wider"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                disabled={isLoading}
                {...register('email')}
                className={`w-full px-4 py-2.5 rounded-xl bg-zinc-950/60 border text-white placeholder-zinc-500 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                  errors.email
                    ? 'border-rose-500/60 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-emerald-500/60'
                }`}
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-rose-400 font-medium">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-zinc-300 mb-1.5 uppercase tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters (1 upper, 1 lower, 1 digit)"
                disabled={isLoading}
                {...register('password')}
                className={`w-full px-4 py-2.5 rounded-xl bg-zinc-950/60 border text-white placeholder-zinc-500 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                  errors.password
                    ? 'border-rose-500/60 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-emerald-500/60'
                }`}
              />
              {errors.password && (
                <p className="mt-1.5 text-xs text-rose-400 font-medium">
                  {errors.password.message}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Must be at least 8 characters with 1 uppercase letter, 1 lowercase letter,
                and 1 digit.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-3 py-3 px-4 rounded-xl font-medium text-sm text-zinc-950 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.99] transition-all duration-150 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-zinc-950"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Creating Account...</span>
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-zinc-800/60 text-center">
            <p className="text-xs text-zinc-400">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
              >
                Sign in to your Vault
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse text-muted text-xs">Loading Vault...</div>
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
