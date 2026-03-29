import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[#5b5ef4] text-white shadow-lg shadow-[#6366f1]/25 hover:bg-[#4f46e5] hover:shadow-[#6366f1]/40",
        destructive:
          "bg-[rgba(127,29,29,0.20)] text-[#f87171] border border-[rgba(153,27,27,0.30)] hover:bg-[rgba(127,29,29,0.35)]",
        outline:
          "border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] text-[#94a3b8] hover:bg-[rgba(255,255,255,0.09)] hover:text-[#e2e8f0]",
        secondary:
          "bg-[rgba(99,102,241,0.08)] text-[#818cf8] border border-[rgba(99,102,241,0.22)] hover:bg-[rgba(99,102,241,0.14)]",
        ghost:
          "text-[#64748b] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#94a3b8]",
        link: "text-[#818cf8] underline-offset-4 hover:underline",
        success:
          "bg-[rgba(6,78,59,0.30)] text-[#10b981] border border-[rgba(6,95,70,0.40)] hover:bg-[rgba(6,78,59,0.50)]",
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
