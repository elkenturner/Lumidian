import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-[rgba(95,126,166,0.30)] bg-[rgba(95,126,166,0.12)] text-[var(--accent-light)]",
        secondary:
          "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]",
        destructive:
          "border-[rgba(153,27,27,0.30)] bg-[rgba(127,29,29,0.20)] text-[var(--danger-text)]",
        success:
          "border-[rgba(6,95,70,0.40)] bg-[rgba(6,78,59,0.30)] text-[var(--success)]",
        warning:
          "border-[rgba(146,64,14,0.40)] bg-[rgba(120,53,15,0.25)] text-[var(--warning)]",
        outline:
          "border-[rgba(255,255,255,0.12)] bg-transparent text-[var(--text-secondary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return (
    <div
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
