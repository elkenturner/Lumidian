import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/25 hover:bg-[var(--accent-hover)] hover:shadow-[var(--accent)]/40",
        destructive:
          "bg-[rgba(127,29,29,0.20)] text-[var(--danger)] border border-[rgba(153,27,27,0.30)] hover:bg-[rgba(127,29,29,0.35)]",
        outline:
          "border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[var(--text-primary)]",
        secondary:
          "bg-[var(--accent-06)] text-[var(--accent-foreground)] border border-[var(--border-default)] hover:bg-[var(--accent-12)]",
        ghost:
          "text-[var(--text-muted)] hover:bg-[var(--bg-tinted)] hover:text-[var(--text-secondary)]",
        link: "text-[var(--accent-foreground)] underline-offset-4 hover:underline",
        success:
          "bg-[rgba(6,78,59,0.30)] text-[var(--success)] border border-[rgba(6,95,70,0.40)] hover:bg-[rgba(6,78,59,0.50)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 rounded-md gap-1.5 px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
