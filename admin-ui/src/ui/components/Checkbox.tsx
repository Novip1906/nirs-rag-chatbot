import * as React from "react";
import { Check, Minus } from "lucide-react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "../utils";

type BaseCheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  "aria-label" | "aria-labelledby"
> & {
  asChild?: boolean;
};

export type CheckboxProps =
  | (BaseCheckboxProps & {
      "aria-label": string;
      "aria-labelledby"?: never;
    })
  | (BaseCheckboxProps & {
      "aria-labelledby": string;
      "aria-label"?: never;
    });

const Checkbox: React.ForwardRefExoticComponent<
  CheckboxProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className = "", ...props }, ref) => (
  /*
      Обёртка нужна только затем, чтобы дать точку отсчёта скрытому полю формы, которое
      Radix кладёт рядом с чекбоксом и позиционирует абсолютно. Без позиционированного
      родителя оно отсчитывается от всей страницы: на экране промптов такое поле уезжало
      на 1206 пикселей вниз, растягивало документ вдвое и уводило боковое меню за край
      окна вместе с прокруткой.
    */
  <span className="relative inline-flex shrink-0">
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer flex size-[18px] shrink-0 items-center justify-center rounded-md border border-border-medium bg-surface-primary text-text-on-status shadow-sm ring-offset-surface-primary transition-colors duration-150",
        "hover:border-border-heavy",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-submit focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-medium",
        "data-[state=checked]:border-surface-submit data-[state=checked]:bg-surface-submit",
        "data-[state=indeterminate]:border-surface-submit data-[state=indeterminate]:bg-surface-submit",
        className,
      )}
      {...props}
    >
      {/*
        `forceMount` — ради самой анимации: Radix иначе вставляет галочку в DOM только в
        момент отметки, а свежевставленный узел не переходит из одного состояния в другое,
        он просто появляется. Смонтированная заранее галочка растёт из точки.
      */}
      <CheckboxPrimitive.Indicator
        forceMount
        className={cn(
          "flex items-center justify-center transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
          "data-[state=unchecked]:scale-50 data-[state=unchecked]:opacity-0",
        )}
      >
        {props.checked === "indeterminate" ? (
          <Minus className="size-3 stroke-[3]" aria-hidden="true" />
        ) : (
          <Check className="size-3 stroke-[3]" aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  </span>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
