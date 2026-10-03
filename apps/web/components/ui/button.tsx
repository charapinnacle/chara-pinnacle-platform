import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary text-sm font-medium whitespace-nowrap text-primary-foreground transition-colors outline-none select-none hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Button({
  className,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ size, className }))}
      {...props}
    />
  )
}

export { Button }
