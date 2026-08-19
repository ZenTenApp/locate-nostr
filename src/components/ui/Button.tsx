import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-brand-primary text-ink-primary hover:brightness-110',
  secondary: 'bg-surface-card text-ink-primary border border-surface-border hover:brightness-125',
  ghost: 'bg-transparent text-ink-secondary hover:text-ink-primary',
  danger: 'bg-state-error text-ink-primary hover:brightness-110',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`rounded-md px-lg py-sm text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  );
}
