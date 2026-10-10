import type { Database } from "@chara-pinnacle/db-types";
import { FormButton } from "@/components/forms/form-button";
import { NativeSelect } from "@/components/forms/native-select";
import { applicationStageOptions } from "@/lib/applications/presentation";

// basePath is the address of the list with everything but the stage and the page (it may carry a query).
type StageFilterProps = { basePath: string; stage: Database["public"]["Enums"]["application_status"] | null };

// The address is the state of the list: the form is a plain GET, so it works without JavaScript, and nothing changes
// until the reader presses Apply (WCAG 3.2.2). It shows the first page of the chosen stage.
export function StageFilter({ basePath, stage }: StageFilterProps) {
  const [path, query = ""] = basePath.split("?");

  return (
    <form action={path} method="get" className="flex flex-wrap items-end gap-3">
      {[...new URLSearchParams(query)].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-2 sm:w-64">
        <label htmlFor="stage-filter" className="text-small leading-snug font-medium">
          Filter by stage
        </label>
        <NativeSelect id="stage-filter" name="stage" defaultValue={stage ?? ""}>
          <option value="">All stages</option>
          {applicationStageOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormButton type="submit" variant="secondary" className="w-auto">
        Apply filter
      </FormButton>
    </form>
  );
}
