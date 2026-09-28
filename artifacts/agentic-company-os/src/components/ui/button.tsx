import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex min-w-0 max-w-full cursor-pointer items-center justify-center gap-2 whitespace-normal rounded-control text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
    " active:translate-y-px motion-reduce:transform-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border hover:bg-destructive/90",
        outline:
          "border [border-color:var(--button-outline)] hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border bg-secondary text-secondary-foreground border-secondary-border hover:bg-secondary/80",
        ghost:
          "border border-transparent hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-4 py-2 md:min-h-9",
        sm: "min-h-10 rounded-control px-3 text-sm md:min-h-8",
        lg: "min-h-12 rounded-control px-8 md:min-h-10",
        icon: "h-11 w-11 md:h-9 md:w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
if (import.meta.env.DEV) Button.displayName = "Button";

export { Button, buttonVariants };
