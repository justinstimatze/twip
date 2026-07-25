import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting a later Tailwind utility win over an earlier one in the same
 * group (`px-2` then `px-4` resolves to `px-4` rather than emitting both and depending on
 * stylesheet order). The shadcn convention, and the reason component variants can be
 * overridden from a call site without `!important`.
 */
export function cn (...inputs) {
  return twMerge(clsx(inputs));
}
