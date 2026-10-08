"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { searchFormSchema, type SearchForm } from "@/lib/validation/admin";

type SearchBoxProps = { label: string; description: string; busy: boolean; onSearch: (term: string) => void };

export function SearchBox({ label, description, busy, onSearch }: SearchBoxProps) {
  const { control, handleSubmit } = useForm<SearchForm>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: { term: "" },
  });

  return (
    <form noValidate className="grid items-start gap-3 sm:grid-cols-[1fr_auto]" onSubmit={handleSubmit(({ term }) => onSearch(term))}>
      <InputField control={control} name="term" label={label} description={description} maxLength={100} autoComplete="off" />
      <FormButton type="submit" busy={busy} className="w-full sm:mt-7 sm:w-auto">
        Search
      </FormButton>
    </form>
  );
}
