import {
  useRef,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  FormProvider,
  type FieldValues,
  type SubmitHandler,
  type SubmitErrorHandler,
  type UseFormReturn,
} from "react-hook-form";

/** Canonical submit boundary; schemas/resolvers remain owned by each workflow. */
export function ValidatedForm<T extends FieldValues>({
  form,
  onSubmit,
  onInvalid,
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit" | "onInvalid"> & {
  form: UseFormReturn<T>;
  onSubmit: SubmitHandler<T>;
  onInvalid?: SubmitErrorHandler<T>;
  children: ReactNode;
}) {
  const submitting = useRef(false);
  const submitOnce = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    try {
      await form.handleSubmit(onSubmit, onInvalid)(event);
    } finally {
      submitting.current = false;
    }
  };
  return (
    <FormProvider {...form}>
      <form {...props} noValidate onSubmit={submitOnce}>
        {children}
      </form>
    </FormProvider>
  );
}
